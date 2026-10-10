import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TURNSTILE_REFUSED } from "../../src/lib/contracts/access";
import { RemovalRequests } from "../../src/modules/safety/components/RemovalRequests";
import {
  ATTESTATION,
  TakedownRequest,
} from "../../src/modules/safety/components/TakedownRequest";
import type {
  PendingTakedownRequest,
  TakedownRequestResult,
} from "../../src/modules/safety/takedown-requests";
import type { TurnstileApi } from "../../src/ui/Turnstile";

/**
 * `/takedown` and Review's removal requests (design 136, D-117), with
 * their server functions handed in as the routes hand them.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const part = (name: string) =>
  document.querySelector<HTMLElement>(`[data-part='${CSS.escape(name)}']`);

afterEach(() => {
  vi.unstubAllGlobals();
});

function answeringTurnstile(token: string): void {
  const api: TurnstileApi = {
    render(_container, options) {
      options.callback(token);
      return "widget-1";
    },
    remove: () => {
      // nothing to tear down
    },
  };
  vi.stubGlobal("turnstile", api);
}

type RequestFn = Parameters<typeof TakedownRequest>[0]["request"];

/**
`expect.stringMatching` is typed `any`; `unknown` keeps it out of no-unsafe-assignment.
*/
const A_KEY: unknown = expect.stringMatching(/^[0-9A-Z]{26}$/u);

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "sam@example.com");
  await user.type(screen.getByLabelText("Your full name"), "Sam Runner");
  await user.type(
    screen.getByLabelText("Link to the image"),
    "https://dialed.run/feed/entry/x",
  );
  await user.type(screen.getByLabelText("What it shows · optional"), "me");
  await user.click(screen.getByLabelText(ATTESTATION));
}

describe("/takedown", () => {
  it("says what happens, and asks for the four parts of a request", async () => {
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Ask us to remove an intimate image",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /A person reads every request and decides within 48 hours/u,
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Your full name")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    expect(screen.getByText("Typing it is your signature.")).toBeVisible();
    expect(screen.getByLabelText("Link to the image")).toHaveAttribute(
      "type",
      "url",
    );
    expect(screen.getByLabelText(ATTESTATION)).not.toBeChecked();
    expect(ATTESTATION).toBe(
      "I am the person shown, or I'm allowed to act for them, and this image was shared without their consent.",
    );
  });

  it("sends the request with its key and Turnstile's answer, and shows the receipt", async () => {
    answeringTurnstile("answer");
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(
      <TakedownRequest siteKey="site" request={request} />,
    );
    const user = userEvent.setup();
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    const receipt = await waitFor(() => {
      const found = part("receipt");
      expect(found).not.toBeNull();
      return found;
    });
    expect(request).toHaveBeenCalledWith({
      data: {
        email: "sam@example.com",
        signature: "Sam Runner",
        location: "https://dialed.run/feed/entry/x",
        description: "me",
        isAttested: true,
        idempotencyKey: A_KEY,
        turnstileToken: "answer",
      },
    });
    const inReceipt = within(receipt ?? document.body);
    expect(inReceipt.getByText("Request sent")).toBeVisible();
    expect(
      inReceipt.getByRole("heading", { name: "We have your request" }),
    ).toBeVisible();
    expect(receipt).toHaveTextContent(
      "A person will look at it and decide within 48 hours. We've emailed a receipt to sam@example.com, and we'll email you the outcome.",
    );
    expect(part("form")).toBeNull();
  });

  it("sends nothing until the statement is confirmed", async () => {
    const request = vi.fn<RequestFn>();
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(
      await screen.findByText("Confirm the statement to send the request."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Type your full name as your signature."),
    ).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it("says the statement's sentence under it when it is the only thing missing", async () => {
    const request = vi.fn<RequestFn>();
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.type(screen.getByLabelText("Your full name"), "Sam Runner");
    await user.type(screen.getByLabelText("Link to the image"), "here");
    await user.click(screen.getByRole("button", { name: "Send request" }));

    const message = await screen.findByText(
      "Confirm the statement to send the request.",
    );
    expect(message).toHaveAttribute("id", "isAttested-message");
    expect(screen.getByLabelText(ATTESTATION)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("says a refusal in the band, as Au5 does, and can send again", async () => {
    const outcomes: TakedownRequestResult[] = [
      { status: "refused" },
      { status: "received" },
    ];
    const request = vi
      .fn<RequestFn>()
      .mockImplementation(() =>
        Promise.resolve(outcomes.shift() ?? { status: "received" }),
      );
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: "Send request" }));

    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not sent");
    expect(band).toHaveTextContent(TURNSTILE_REFUSED);
    await user.click(
      within(band ?? document.body).getByRole("button", { name: "Try again" }),
    );
    await waitFor(() => {
      expect(part("receipt")).not.toBeNull();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

type DecideFn = Parameters<typeof RemovalRequests>[0]["decide"];

const ENTRY = "01JABCDEFGHJKMNPQRSTVWXYZ0";

function pending(
  overrides: Partial<PendingTakedownRequest> = {},
): PendingTakedownRequest {
  return {
    id: "01JREQUEST0000000000000001",
    requesterEmail: "sam@example.com",
    signature: "Sam Runner",
    location: `https://dialed.run/feed/entry/${ENTRY}`,
    description: undefined,
    subject: { subjectType: "entry", subjectId: ENTRY, entryId: ENTRY },
    createdAt: 1,
    dueAt: 2,
    due: "Due in 31h",
    ...overrides,
  };
}

describe("Review · removal requests", () => {
  it("shows the clock, who asked, what they said, and opens the kit", async () => {
    await renderWithRouter(
      <RemovalRequests
        requests={[pending({ description: "a photo of me" })]}
        decide={vi.fn<DecideFn>()}
      />,
    );
    const row = part("removal-request");
    expect(row).toHaveTextContent("[Due in 31h]");
    expect(row).toHaveTextContent("Sam Runner · sam@example.com");
    expect(row).toHaveTextContent(`https://dialed.run/feed/entry/${ENTRY}`);
    expect(row).toHaveTextContent("a photo of me");
    const open = screen.getByRole("link", { name: "Open the kit" });
    expect(open).toHaveAttribute("href", `/feed/entry/${ENTRY}`);
    expect(open).toHaveClass("target");
    expect(screen.getByText("[1 removal requests]")).toBeInTheDocument();
  });

  it("opens a reported photo's kit, and says when a link is not ours", async () => {
    await renderWithRouter(
      <RemovalRequests
        requests={[
          pending({
            id: "01JREQUEST0000000000000002",
            subject: { subjectType: "photo", subjectId: "p", entryId: ENTRY },
          }),
          pending({
            id: "01JREQUEST0000000000000003",
            subject: undefined,
            location: "somewhere",
          }),
        ]}
        decide={vi.fn<DecideFn>()}
      />,
    );
    expect(screen.getByRole("link", { name: "Open its kit" })).toHaveAttribute(
      "href",
      `/feed/entry/${ENTRY}`,
    );
    expect(
      screen.getByText("Not one of our links: find it from what they wrote."),
    ).toBeVisible();
  });

  it("takes it down, and the request leaves the list", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests requests={[pending()]} decide={decide} />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Take it down" }));
    await waitFor(() => {
      expect(part("removal-request")).toBeNull();
    });
    expect(decide).toHaveBeenCalledWith({
      data: { requestId: "01JREQUEST0000000000000001", outcome: "removed" },
    });
  });

  it("declines only with a reason, and sends it", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests requests={[pending()]} decide={decide} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(
      await screen.findAllByText("Say why, for the person who asked."),
    ).not.toHaveLength(0);
    expect(decide).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Why not"), "shoes");
    expect(
      screen.getByText("The person who asked is sent this."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => {
      expect(part("removal-request")).toBeNull();
    });
    expect(decide).toHaveBeenCalledWith({
      data: {
        requestId: "01JREQUEST0000000000000001",
        outcome: "declined",
        reason: "shoes",
      },
    });
  });

  it("renders nothing when nothing is waiting", async () => {
    await renderWithRouter(
      <RemovalRequests requests={[]} decide={vi.fn<DecideFn>()} />,
    );
    expect(part("removal-request")).toBeNull();
    expect(screen.queryByText(/removal requests/u)).toBeNull();
  });
});
