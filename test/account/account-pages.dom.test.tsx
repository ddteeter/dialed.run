import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { currentPasswordLimited } from "../../src/lib/contracts";
import { clockLabel, deviceTimeZone } from "../../src/lib/dates";
import { ChangeEmail } from "../../src/modules/account/components/ChangeEmail";
import { CheckEmail } from "../../src/modules/account/components/CheckEmail";
import { ConfirmEmailBand } from "../../src/modules/account/components/ConfirmEmailBand";
import {
  ConfirmEmailSheet,
  confirmEmailGate,
} from "../../src/modules/account/components/ConfirmEmailSheet";
import {
  LinkLanding,
  landingCopy,
} from "../../src/modules/account/components/LinkLanding";
import {
  ResendLink,
  SENT_FOR_MS,
  limitedMessage,
} from "../../src/modules/account/components/ResendLink";
import type {
  ChangeResult,
  ResendResult,
} from "../../src/modules/account/verification";

/**
 * Round 26 #11's pages, as a runner meets them: Au4, the link landings,
 * the three Resend states, the "Confirm your email first" sheet and the
 * nag, and ACC-8's email change.
 */

const PLACES = [
  "/feed",
  "/auth/login",
  "/auth/signup",
  "/account/check-email",
] as const;

async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const others = PLACES.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>at {path}</p>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...others]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

function resender(...answers: (ResendResult | Error)[]) {
  return vi.fn(() => {
    const answer = answers.shift() ?? { status: "sent" };
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer);
  });
}

const status = () => screen.getByRole("status");
const resendButton = () => screen.getByRole("button", { name: "Resend link" });

afterEach(() => {
  vi.useRealTimers();
});

describe("ResendLink", () => {
  it("sends to the address it was given, says Sent ✓ for a minute, then rests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    const resend = resender({ status: "sent" });
    render(<ResendLink email="maya@example.com" resend={resend} />);

    await user.click(resendButton());

    expect(resend).toHaveBeenCalledWith({
      data: { email: "maya@example.com" },
    });
    const sent = await screen.findByText(
      "A new link is on its way. The old one no longer works.",
    );
    expect(sent.closest("[data-state]")).toHaveAttribute("data-state", "sent");
    expect(sent.closest("p")).toHaveTextContent(/^Sent ✓ A new link/u);
    expect(status()).toHaveTextContent(
      "Sent. A new link is on its way. The old one no longer works.",
    );

    // Half the minute (the fake clock also creeps with real time, so the
    // edges are not asserted to the millisecond).
    act(() => {
      vi.advanceTimersByTime(SENT_FOR_MS / 2);
    });
    expect(screen.getByText(/^Sent ✓/u)).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(SENT_FOR_MS / 2);
    });
    expect(screen.queryByText(/^Sent ✓/u)).toBeNull();
    expect(status()).toHaveTextContent(/^$/u);
    expect(SENT_FOR_MS).toBe(60_000);
  });

  it("brackets the button while it sends, and never disables it", async () => {
    const pending = Promise.withResolvers<ResendResult>();
    const resend = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    render(<ResendLink email="maya@example.com" resend={resend} />);

    await user.click(resendButton());
    const button = screen.getByRole("button", { name: /Resend link|Sending/u });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toHaveAttribute("disabled");
    // A second press while one is in flight is not a second send.
    await user.click(button);
    expect(resend).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve({ status: "sent" });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(resendButton()).not.toHaveAttribute("aria-busy");
    });
  });

  it("bands NOT SENT when the hour's links are used up, naming when the next can go", async () => {
    const until = 1_800_000_000;
    const resend = resender({ status: "limited", until }, { status: "sent" });
    const user = userEvent.setup();
    render(<ResendLink email="maya@example.com" resend={resend} />);

    await user.click(resendButton());

    const band = await screen.findByText(limitedMessage(until));
    expect(band.closest("[data-part=failure-band]")).toHaveTextContent(
      /Not sent/u,
    );
    expect(limitedMessage(until)).toMatch(
      /^That's 5 links this hour\. You can send another at \d{1,2}:\d{2} [AP]M\.$/u,
    );
    expect(status()).toHaveTextContent(`Not sent. ${limitedMessage(until)}`);
    expect(screen.queryByText(/^Sent ✓/u)).toBeNull();

    // The band's Try again is a resend; a sent one clears the band.
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(resend).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/^Sent ✓/u)).toBeVisible();
    expect(screen.queryByText(limitedMessage(until))).toBeNull();
  });

  it("bands a failed send with its cause, and Try again sends again", async () => {
    const resend = resender(new Error("down"), { status: "sent" });
    const user = userEvent.setup();
    render(<ResendLink email="maya@example.com" resend={resend} />);

    await user.click(resendButton());

    expect(await screen.findByText("Our end failed.")).toBeVisible();
    expect(status()).toHaveTextContent("Not sent. Our end failed.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/^Sent ✓/u)).toBeVisible();
    expect(resend).toHaveBeenCalledTimes(2);
  });

  it("does not arm the sixty-second timeout before anything has been sent", () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    render(<ResendLink email="maya@example.com" resend={resender()} />);
    expect(timeout).not.toHaveBeenCalledWith(expect.any(Function), SENT_FOR_MS);
    timeout.mockRestore();
  });

  it("cancels the first minute's timer when a fresh send restarts it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });
    const resend = resender();
    render(<ResendLink email="maya@example.com" resend={resend} />);

    await user.click(resendButton());
    await screen.findByText(/^Sent ✓/u);

    // Halfway through the first minute, send again.
    act(() => {
      vi.advanceTimersByTime(SENT_FOR_MS / 2);
    });
    expect(screen.getByText(/^Sent ✓/u)).toBeVisible();
    await user.click(resendButton());
    await waitFor(() => {
      expect(resend).toHaveBeenCalledTimes(2);
    });
    await screen.findByText(/^Sent ✓/u);

    // If the first timer were not cancelled it would still fire here — a
    // full minute after the *first* send, but only half a minute after the
    // second — and wrongly clear "Sent" early.
    act(() => {
      vi.advanceTimersByTime(SENT_FOR_MS / 2 + 5000);
    });
    expect(screen.getByText(/^Sent ✓/u)).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(SENT_FOR_MS);
    });
    expect(screen.queryByText(/^Sent ✓/u)).toBeNull();
  });
});

describe("CheckEmail (Au4)", () => {
  it("says where the link went and how long it lasts, whoever signed up", async () => {
    await renderWithRouter(
      <CheckEmail
        email="maya@example.com"
        isSignedIn={false}
        resend={resender()}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Check your email" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Open it on any device to confirm the address\./u),
    ).toHaveTextContent(
      "We sent a link to maya@example.com. Open it on any device to confirm the address.",
    );
    expect(
      screen.getByText(
        "It works once, for 24 hours. Not there? Check spam, or send it again.",
      ),
    ).toBeVisible();
    expect(resendButton()).toBeVisible();
  });

  it("signed out, offers Start over and log-in — and never says 'You're signed in'", async () => {
    await renderWithRouter(
      <CheckEmail
        email="maya@example.com"
        isSignedIn={false}
        resend={resender()}
      />,
    );
    const startOver = screen.getByRole("link", { name: "Start over" });
    expect(startOver).toHaveAttribute("href", "/auth/signup");
    expect(startOver).toHaveClass("underline");
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    expect(
      screen.getByText(/^Wrong address\?/u).closest("p"),
    ).toHaveTextContent("Wrong address? Start over");
    expect(
      screen.getByText(/^Carry on without confirming\?/u).closest("p"),
    ).toHaveTextContent("Carry on without confirming? Log in");
    expect(screen.queryByText(/signed in/u)).toBeNull();
  });

  it("signed in, says so and offers the closet, as round 26 draws it", async () => {
    await renderWithRouter(
      <CheckEmail email="maya@example.com" isSignedIn resend={resender()} />,
    );
    expect(
      screen.getByText(/^You're signed in\./u).closest("p"),
    ).toHaveTextContent("You're signed in. Carry on to your closet ›");
    expect(
      screen.getByRole("link", { name: "Carry on to your closet ›" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Start over" })).toBeNull();
  });
});

describe("LinkLanding", () => {
  it.each([
    [
      { state: "confirmed", purpose: "verify", email: "m@example.com" },
      "Confirmed",
      "text-dialed-text",
      "Email confirmed",
      "Your runs can go on the feed now.",
      "Open the feed",
      "/feed",
    ],
    [
      { state: "confirmed", purpose: "change", email: "new@example.com" },
      "Confirmed",
      "text-dialed-text",
      "Email changed",
      "Your account's email is now new@example.com.",
      "Open dialed.run",
      "/",
    ],
    [
      { state: "used" },
      "Already confirmed",
      "text-dialed-text",
      "Your email is confirmed",
      "That link was already used, and the address is confirmed. Nothing to do.",
      "Open dialed.run",
      "/",
    ],
    [
      { state: "expired" },
      "Link expired",
      "text-cold-text",
      "That link has run out",
      "Links work for 24 hours. Log in and we'll send a fresh one.",
      "Log in to resend",
      "/auth/login?redirect=%2Faccount%2Fcheck-email",
    ],
  ] as const)(
    "lands %o on its kicker, heading, sentence and way on",
    async (landing, kicker, tone, heading, body, action, href) => {
      await renderWithRouter(<LinkLanding landing={landing} />);
      expect(screen.getByText(kicker)).toHaveClass(tone);
      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      expect(screen.getByText(body)).toBeVisible();
      const link = screen.getByRole("link", { name: action });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveClass("target");
      expect(
        screen.getByText(body).closest("[data-part=landing]"),
      ).toHaveAttribute("data-state", landing.state);
    },
  );

  it("never promises a queued share (decision D-50)", () => {
    const copy = landingCopy({
      state: "confirmed",
      purpose: "verify",
      email: "m@example.com",
    });
    expect(copy.body).not.toMatch(/shared while waiting/u);
  });
});

describe("the confirm-first sheet and the nag", () => {
  it("opens as a sheet naming the address, with Resend and Not now", async () => {
    const onClose = vi.fn();
    const resend = resender();
    const user = userEvent.setup();
    render(
      <ConfirmEmailSheet
        open
        onClose={onClose}
        email="maya@example.com"
        resend={resend}
      />,
    );
    const sheet = screen.getByRole("dialog", {
      name: "Confirm your email first",
    });
    expect(
      within(sheet).getByRole("heading", { name: "Confirm your email first" }),
    ).toBeVisible();
    expect(within(sheet).getByText(/We sent a link to/u)).toHaveTextContent(
      /^We sent a link to maya@example\.com\.$/u,
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Resend link" }),
    );
    expect(resend).toHaveBeenCalledWith({
      data: { email: "maya@example.com" },
    });
    await user.click(within(sheet).getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("lands on Not now, the way out, when it opens (round 27 #17)", async () => {
    const resend = resender();
    const { rerender } = render(
      <ConfirmEmailSheet
        open={false}
        onClose={vi.fn()}
        email="maya@example.com"
        resend={resend}
      />,
    );
    // Shut, it takes nothing: the page keeps its own focus.
    expect(document.activeElement).toBe(document.body);

    rerender(
      <ConfirmEmailSheet
        open
        onClose={vi.fn()}
        email="maya@example.com"
        resend={resend}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Not now" })).toHaveFocus();
    });
  });

  it.each([
    [
      "useful",
      "Marking runs Useful, sharing and reporting need a confirmed address. We sent a link to maya@example.com.",
    ],
    [
      "report",
      "Reporting, sharing and marking runs Useful need a confirmed address. We sent a link to maya@example.com.",
    ],
  ] as const)(
    "leads with what the %s control was waiting for",
    (trigger, body) => {
      render(
        <ConfirmEmailSheet
          open
          onClose={vi.fn()}
          email="maya@example.com"
          resend={resender()}
          trigger={trigger}
        />,
      );
      expect(screen.getByText(/We sent a link to/u)).toHaveTextContent(body);
    },
  );

  it("is the sheet a route hands a screen, led by the control the server refused", async () => {
    const resend = resender();
    const user = userEvent.setup();
    const onClose = vi.fn();
    const gate = confirmEmailGate({ email: "maya@example.com" }, resend);

    render(<>{gate.sheet({ open: true, trigger: "report" }, onClose)}</>);
    const sheet = screen.getByRole("dialog", {
      name: "Confirm your email first",
    });
    expect(within(sheet).getByText(/We sent a link to/u)).toHaveTextContent(
      /^Reporting, .* We sent a link to maya@example\.com\.$/u,
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Resend link" }),
    );
    expect(resend).toHaveBeenCalledWith({
      data: { email: "maya@example.com" },
    });
    await user.click(within(sheet).getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("leads with Useful when Useful was refused", () => {
    const gate = confirmEmailGate({ email: "maya@example.com" }, resender());
    render(<>{gate.sheet({ open: true, trigger: "useful" }, vi.fn())}</>);
    expect(screen.getByText(/We sent a link to/u)).toHaveTextContent(
      /^Marking runs Useful, /u,
    );
  });

  it("stays shut until the screen opens it", () => {
    const gate = confirmEmailGate({ email: "maya@example.com" }, resender());
    render(<>{gate.sheet({ open: false, trigger: undefined }, vi.fn())}</>);
    expect(document.querySelector("dialog")?.open).toBe(false);
  });

  it("nags an unconfirmed runner once, and says nothing to a confirmed one or nobody", () => {
    const resend = resender();
    const { rerender } = render(
      <ConfirmEmailBand
        account={{ email: "maya@example.com", isVerified: false }}
        resend={resend}
      />,
    );
    const band = screen.getByRole("complementary", {
      name: "Confirm your email",
    });
    expect(band).toHaveTextContent(
      /^Confirm your email to share runs with other runners\./u,
    );
    expect(
      within(band).getByRole("button", { name: "Resend link" }),
    ).toBeVisible();
    // No dismiss: it goes once the address is confirmed.
    expect(
      within(band).queryByRole("button", { name: /dismiss|close/iu }),
    ).toBeNull();

    rerender(
      <ConfirmEmailBand
        account={{ email: "maya@example.com", isVerified: true }}
        resend={resend}
      />,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    rerender(<ConfirmEmailBand account={undefined} resend={resend} />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

function renderChange(
  options: Readonly<{
    isVerified?: boolean;
    answer?: ChangeResult;
  }> = {},
) {
  const request = vi.fn(() =>
    Promise.resolve(options.answer ?? ({ status: "sent" } as const)),
  );
  const resend = resender();
  render(
    <ChangeEmail
      current="old@example.com"
      isVerified={options.isVerified ?? true}
      request={request}
      resend={resend}
    />,
  );
  return { request, resend, user: userEvent.setup() };
}

const newEmailField = () => screen.getByRole("textbox", { name: "New email" });
const currentPasswordField = () => screen.getByLabelText("Current password");
/**
Not a secret: typed into a form whose request is a mock.
*/
const PASSWORD = ["the", "current", "one"].join("-");

async function fillChange(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
): Promise<void> {
  await user.type(newEmailField(), email);
  await user.type(currentPasswordField(), PASSWORD);
}
const sendLink = () => screen.getByRole("button", { name: "Send link" });

describe("ChangeEmail (ACC-8)", () => {
  it("sends the link to the new address and says nothing moves until it is opened", async () => {
    const { request, user } = renderChange();
    expect(screen.getByText(/^Now /u)).toHaveTextContent(
      "Now old@example.com. We'll send a link to the new address, and the account moves when you open it.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await fillChange(user, "new@example.com");
    await user.click(sendLink());

    expect(request).toHaveBeenCalledWith({
      data: { email: "new@example.com", currentPassword: PASSWORD },
    });
    const sent = await screen.findByText(/^Sent ✓/u);
    expect(sent.closest("p")).toHaveTextContent(
      "Sent ✓ Open the link we sent to the new address. Your email stays old@example.com until you do.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Link sent.");
    // A "sent" answer is not "unverified": the confirm-first sheet stays
    // closed, it does not open for every successful send.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("prevents the browser's own submit, so the SPA's own handler is the only one", async () => {
    const { user } = renderChange();
    let submitEvent: Event | undefined;
    document.addEventListener("submit", (event) => {
      submitEvent = event;
    });
    await fillChange(user, "new@example.com");
    await user.click(sendLink());
    expect(submitEvent?.defaultPrevented).toBe(true);
  });

  it("refuses a malformed address in the field, before the round trip", async () => {
    const { request, user } = renderChange();
    await fillChange(user, "not-an-address");
    await user.click(sendLink());
    expect(
      await screen.findByText("That does not look like an email address."),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("bands the hour's limit", async () => {
    const until = 1_800_000_000;
    const { request, user } = renderChange({
      answer: { status: "limited", until },
    });
    await fillChange(user, "new@example.com");
    await user.click(sendLink());
    expect(await screen.findByText(limitedMessage(until))).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("while unconfirmed, opens the confirm-first sheet instead of sending", async () => {
    const { request, user } = renderChange({ isVerified: false });
    await fillChange(user, "new@example.com");
    await user.click(sendLink());
    expect(request).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", {
      name: "Confirm your email first",
    });
    expect(within(sheet).getByText(/We sent a link to/u)).toHaveTextContent(
      "old@example.com",
    );
    await user.click(within(sheet).getByRole("button", { name: "Not now" }));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Confirm your email first" }),
      ).toBeNull();
    });
  });

  it("opens the sheet when the server says the address is not confirmed", async () => {
    const { user } = renderChange({ answer: { status: "unverified" } });
    await fillChange(user, "new@example.com");
    await user.click(sendLink());
    expect(
      await screen.findByRole("dialog", { name: "Confirm your email first" }),
    ).toBeVisible();
    expect(screen.queryByText(/^Sent ✓/u)).toBeNull();
  });

  it("asks for the current password before the round trip", async () => {
    const { request, user } = renderChange();
    await user.type(newEmailField(), "new@example.com");
    await user.click(sendLink());
    expect(
      await screen.findByText("Enter your current password."),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("lands used-up tries at the password on its field, with when to try again", async () => {
    const until = 1_800_000_000;
    const { user } = renderChange({
      answer: { status: "password-limited", until },
    });
    await fillChange(user, "new@example.com");
    await user.click(sendLink());
    const clock = clockLabel(until, deviceTimeZone());
    expect(
      await screen.findByText(currentPasswordLimited(clock)),
    ).toBeVisible();
    expect(currentPasswordField()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/^Sent ✓/u)).toBeNull();
  });

  it("lands a wrong current password on its field, and says nothing was sent", async () => {
    const { user } = renderChange({ answer: { status: "wrong-password" } });
    await fillChange(user, "new@example.com");
    await user.click(sendLink());
    expect(
      await screen.findByText("That's not your current password."),
    ).toBeVisible();
    expect(currentPasswordField()).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(/^Sent ✓/u)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
