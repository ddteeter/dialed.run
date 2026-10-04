import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { TURNSTILE_REFUSED } from "../../src/lib/contracts/access";
import type { AccessRequestResult } from "../../src/modules/account/access";
import {
  DeskAccess,
  UNDO_WINDOW_MS,
  ageLabel,
  codeCounts,
  madeLine,
  orderedCodes,
} from "../../src/modules/account/components/DeskAccess";
import {
  NOTE_COUNTER_ID,
  RequestAccess,
  noteAnnouncement,
  refusalMessage,
} from "../../src/modules/account/components/RequestAccess";
import type { AccessDesk, DeskCode } from "../../src/modules/account/invites";
import type { TurnstileApi } from "../../src/ui/Turnstile";

/**
 * Au5 · Request access and Desk D7 · Access (task 126, ACC-5; round 26
 * #20), with their server functions handed in as the routes hand them.
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

/**
A real `null`, not the literal — unicorn/no-null forbids the keyword, and
these fixtures assert against genuinely nullable fields.
*/
const NOTHING = z.null().parse(JSON.parse("null"));

/**
`expect.any(...)` is typed `any`; `unknown` here is what keeps assigning
it into a fixture object from tripping no-unsafe-assignment.
*/
const ANY_STRING: unknown = expect.any(String);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
A Turnstile that answers at once with `token`.
*/
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

type RequestFn = (input: {
  data: { email: string; note: string; turnstileToken?: string | undefined };
}) => Promise<AccessRequestResult>;

describe("Au5 · Request access", () => {
  it("asks for an email and an optional note, with the board's words", async () => {
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Request access" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "We're letting runners in a few at a time. Leave your email and we'll send a code when there's room.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Note · optional")).toBeVisible();
    expect(
      screen.getByText("Where you run, or who sent you. One line."),
    ).toBeVisible();
    // Round 28 #9: the back link is the pack's glyph and the destination's
    // name, above the heading, and no "‹" anywhere.
    const back = screen.getByRole("link", { name: "Create an account" });
    expect(back).toHaveAttribute("href", "/auth/signup");
    expect(back.querySelector("svg")).not.toBeNull();
    expect(
      back.compareDocumentPosition(screen.getByRole("heading", { level: 1 })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(document.body).not.toHaveTextContent("‹");
    expect(
      screen.getByRole("button", { name: "Send request" }),
    ).toBeInTheDocument();
  });

  it("counts the note's characters from 120 of its 140, muted, then ink and semibold past it (round 29 #8)", async () => {
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );
    const note = screen.getByLabelText("Note · optional");
    fireEvent.change(note, { target: { value: "n".repeat(119) } });
    expect(screen.queryByText(/\/ 140$/u)).toBeNull();
    expect(note).not.toHaveAttribute("aria-describedby");
    fireEvent.change(note, { target: { value: "n".repeat(120) } });
    const counter = (): HTMLElement => {
      const found = document.querySelector<HTMLElement>(`#${NOTE_COUNTER_ID}`);
      if (found === null) throw new Error("no counter");
      return within(found).getByText(/\/ 140$/u);
    };
    const near = counter();
    expect(near).toHaveTextContent(/^120 \/ 140$/u);
    expect(near).toHaveClass("text-muted");
    expect(near).not.toHaveClass("font-semibold");
    // Not a region of its own: the field names it, and the form's one
    // status region says it.
    expect(near.closest("[aria-live]")).toBeNull();
    expect(document.querySelector(`#${NOTE_COUNTER_ID}`)).toHaveClass(
      "self-end",
    );
    expect(note).toHaveAttribute("aria-describedby", NOTE_COUNTER_ID);
    fireEvent.change(note, { target: { value: "n".repeat(140) } });
    expect(counter()).toHaveTextContent(/^140 \/ 140$/u);
    expect(counter()).toHaveClass("text-muted");
    fireEvent.change(note, { target: { value: "n".repeat(141) } });
    const over = counter();
    expect(over).toHaveTextContent(/^141 \/ 140$/u);
    expect(over).toHaveClass("font-semibold", "text-ink");
    expect(over).not.toHaveClass("text-muted");
  });

  it("announces the count at 120 and at 141 only, in the form's one status region", async () => {
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );
    const note = screen.getByLabelText("Note · optional");
    const status = screen.getByRole("status");
    fireEvent.change(note, { target: { value: "n".repeat(119) } });
    expect(status).toHaveTextContent(/^$/u);
    fireEvent.change(note, { target: { value: "n".repeat(120) } });
    expect(status).toHaveTextContent(/^120 \/ 140$/u);
    fireEvent.change(note, { target: { value: "n".repeat(141) } });
    expect(status).toHaveTextContent(/^141 \/ 140$/u);
    fireEvent.change(note, { target: { value: "n".repeat(142) } });
    expect(status).toHaveTextContent(/^141 \/ 140$/u);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps the field's own message first in its description, the counter after", async () => {
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );
    const note = screen.getByLabelText("Note · optional");
    fireEvent.change(note, { target: { value: "n".repeat(141) } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => {
      expect(note).toHaveAttribute(
        "aria-describedby",
        `note-message ${NOTE_COUNTER_ID}`,
      );
    });
    // The text is kept, never truncated.
    expect(note).toHaveValue("n".repeat(141));
  });

  it("announces only on crossing 120 or 140, whichever way a change jumps", () => {
    expect(noteAnnouncement(118, 119)).toBeUndefined();
    expect(noteAnnouncement(119, 120)).toBe("120 / 140");
    expect(noteAnnouncement(120, 121)).toBeUndefined();
    expect(noteAnnouncement(0, 130)).toBe("130 / 140");
    expect(noteAnnouncement(139, 140)).toBeUndefined();
    expect(noteAnnouncement(140, 141)).toBe("141 / 140");
    expect(noteAnnouncement(141, 142)).toBeUndefined();
    expect(noteAnnouncement(130, 150)).toBe("150 / 140");
    expect(noteAnnouncement(130, 120)).toBeUndefined();
    expect(noteAnnouncement(141, 140)).toBeUndefined();
  });

  it("sends the request with Turnstile's answer and shows the one receipt", async () => {
    answeringTurnstile("answer");
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(<RequestAccess siteKey="site" request={request} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.type(screen.getByLabelText("Note · optional"), "Duluth.");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    const receipt = await waitFor(() => {
      const found = part("receipt");
      expect(found).not.toBeNull();
      return found;
    });
    expect(request).toHaveBeenCalledWith({
      data: {
        email: "sam@example.com",
        note: "Duluth.",
        turnstileToken: "answer",
      },
    });
    const inReceipt = within(receipt ?? document.body);
    expect(inReceipt.getByText("On the list")).toBeVisible();
    expect(
      inReceipt.getByRole("heading", { name: "You're on the list" }),
    ).toBeVisible();
    expect(receipt).toHaveTextContent(
      "When there's room, we'll email a code to sam@example.com. There's nothing else to do until then.",
    );
    expect(inReceipt.getByText(/Have a code after all\?/)).toBeVisible();
    // The question and its link read as one sentence, a space between.
    expect(inReceipt.getByText(/Have a code after all\?/).textContent).toBe(
      "Have a code after all? Create an account",
    );
    const receiptLink = inReceipt.getByRole("link", {
      name: "Create an account",
    });
    expect(receiptLink).toHaveAttribute("href", "/auth/signup");
    expect(receiptLink).toHaveClass("font-bold", "text-ink", "underline");
    expect(part("form")).toBeNull();
  });

  it("names both fields by their labels in the summary when both are wrong", async () => {
    const request = vi.fn<RequestFn>();
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "nope");
    fireEvent.change(screen.getByLabelText("Note · optional"), {
      target: { value: "n".repeat(141) },
    });
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("button", { name: /^Email/ })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Note · optional/ }),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("announces the request was sent before it swaps to the receipt", async () => {
    vi.useFakeTimers();
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={request} />,
    );
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "sam@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send request" }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Request sent.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText("On the list")).toBeVisible();
  });

  it("says a Turnstile refusal as NOT SENT, and tries again from the band", async () => {
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValueOnce({ status: "refused" })
      .mockResolvedValueOnce({ status: "received" });
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not sent");
    expect(band).toHaveTextContent(TURNSTILE_REFUSED);
    expect(request).toHaveBeenLastCalledWith({
      data: { email: "sam@example.com", note: "", turnstileToken: undefined },
    });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(part("receipt")).not.toBeNull();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("refuses a bad address on its field, before any round trip", async () => {
    const request = vi.fn<RequestFn>();
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "sam");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(
      await screen.findByText("That does not look like an email address."),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("leaves the back link off the receipt", async () => {
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(
      <RequestAccess siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => {
      expect(part("receipt")).not.toBeNull();
    });
    // The receipt's own "Create an account" is the only one.
    expect(
      screen.getAllByRole("link", { name: "Create an account" }),
    ).toHaveLength(1);
  });

  it("names the limit's time, and Turnstile's sentence for its refusal", () => {
    expect(refusalMessage({ status: "refused" })).toBe(TURNSTILE_REFUSED);
    expect(refusalMessage({ status: "limited", until: 0 })).toMatch(
      /^Too many requests from here\. You can send another at .+\.$/u,
    );
  });
});

function code(overrides: Partial<DeskCode> = {}): DeskCode {
  return {
    id: "c1",
    code: "DIAL-TR8K",
    label: "Tuesday track group",
    maxUses: 8,
    createdAt: 0,
    isRevoked: false,
    usedBy: ["@dee_k", "@paulo"],
    ...overrides,
  };
}

const DESK: AccessDesk = {
  requests: [
    {
      id: "r1",
      email: "sam@example.com",
      note: "Winter runner.",
      createdAt: 0,
    },
    { id: "r2", email: "j@example.com", note: NOTHING, createdAt: 3600 * 20 },
  ],
  codes: [
    code(),
    code({
      id: "c2",
      code: "DIAL-7K3P",
      label: NOTHING,
      maxUses: 1,
      usedBy: ["maya@example.com"],
    }),
    code({ id: "c3", code: "DIAL-H2XN", isRevoked: true, usedBy: [] }),
  ],
};

function desk(overrides: Partial<Parameters<typeof DeskAccess>[0]> = {}) {
  const props = {
    desk: DESK,
    asOf: 3 * 24 * 3600,
    linkFor: (value: string) => `https://dialed.run/join?code=${value}`,
    copy: vi.fn(() => Promise.resolve()),
    onChanged: vi.fn(() => Promise.resolve()),
    createCode: vi.fn(() => Promise.resolve({ code: "DIAL-NEW2" })),
    sendInvite: vi.fn(() => Promise.resolve()),
    decline: vi.fn(() => Promise.resolve()),
    revoke: vi.fn(() => Promise.resolve()),
    restore: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  render(<DeskAccess {...props} />);
  return { props, user: userEvent.setup() };
}

function undo(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Undo" });
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("li");
  if (row === null) throw new Error(`no row for ${text}`);
  return row;
}

describe("D7 · Access", () => {
  it("lists requests oldest first with their age and note, and counts them", () => {
    desk();
    expect(screen.getByText("2 waiting · oldest first")).toBeVisible();
    const sam = within(rowOf("sam@example.com"));
    expect(sam.getByText("3d")).toBeVisible();
    expect(sam.getByText("Winter runner.")).toBeVisible();
    // A real note is ink; only the absence of one is muted.
    expect(sam.getByText("Winter runner.")).toHaveClass("text-ink");
    const j = within(rowOf("j@example.com"));
    expect(j.getByText("No note.")).toHaveClass("text-muted");
    expect(j.getByText("2d")).toBeVisible();
  });

  it("shows nothing in its own status line until something happens", () => {
    desk();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("");
    // The Codes section's own status line (what a made code's line fills
    // in) starts empty too, before any code is made.
    expect(part("status-line")).toHaveTextContent("");
  });

  it("sends an invite and declines, each reloading the page", async () => {
    const { props, user } = desk();
    await user.click(
      within(rowOf("sam@example.com")).getByRole("button", {
        name: "Send invite",
      }),
    );
    await waitFor(() => {
      expect(props.onChanged).toHaveBeenCalledTimes(1);
    });
    expect(props.sendInvite).toHaveBeenCalledWith({ data: { id: "r1" } });
    await user.click(
      within(rowOf("j@example.com")).getByRole("button", { name: "Decline" }),
    );
    await waitFor(() => {
      expect(props.decline).toHaveBeenCalledWith({ data: { id: "r2" } });
    });
  });

  it.each([
    {
      action: "Send invite" as const,
      prop: "sendInvite" as const,
      kicker: "Not sent",
      sentence: "Send invite didn't go through. No email went out. Try again?",
    },
    {
      action: "Decline" as const,
      prop: "decline" as const,
      kicker: "Still waiting",
      sentence:
        "Decline didn't go through. The request is still here. Try again?",
    },
  ])(
    "says $kicker under the row whose $action failed, announces it, and retries it there (round 29 #14)",
    async ({ action, prop, kicker, sentence }) => {
      const act = vi
        .fn()
        .mockRejectedValueOnce(new Error("down"))
        .mockResolvedValueOnce(undefined);
      const { props, user } = desk({ [prop]: act });
      const button = within(rowOf("j@example.com")).getByRole("button", {
        name: action,
      });
      await user.click(button);
      const band = await waitFor(() => {
        const found = within(rowOf("j@example.com")).getByText(kicker);
        return found.closest("[data-part='failure-band']");
      });
      expect(band).toHaveTextContent(sentence);
      // On its own row only, and no page-level band above the sections.
      expect(
        document.querySelectorAll("[data-part='failure-band']"),
      ).toHaveLength(1);
      expect(within(rowOf("sam@example.com")).queryByText(kicker)).toBeNull();
      expect(screen.queryByText("Not changed")).toBeNull();
      // Said once, in the page's one status region, in the band's words.
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        `${kicker}. ${sentence}`,
      );
      // Focus stays on the control that failed.
      expect(button).toHaveFocus();
      // Nothing optimistic: the page was not reloaded for a failure.
      expect(props.onChanged).not.toHaveBeenCalled();
      await user.click(
        within(rowOf("j@example.com")).getByRole("button", {
          name: "Try again",
        }),
      );
      await waitFor(() => {
        expect(act).toHaveBeenCalledTimes(2);
      });
      expect(act).toHaveBeenLastCalledWith({ data: { id: "r2" } });
      await waitFor(() => {
        expect(part("failure-band")).toBeNull();
      });
    },
  );

  it("keeps the last thing said when another row action starts and has not failed", async () => {
    const pending = Promise.withResolvers<undefined>();
    const { user } = desk({ sendInvite: vi.fn(() => pending.promise) });
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Copy link" }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Link copied.",
      );
    });
    await user.click(
      within(rowOf("sam@example.com")).getByRole("button", {
        name: "Send invite",
      }),
    );
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Link copied.");
    await act(async () => {
      pending.resolve(undefined);
      await Promise.resolve();
    });
  });

  it("lists codes with their label, who used them and their uses, and counts them", () => {
    desk();
    expect(screen.getByText("1 active · 3 used")).toBeVisible();
    const open = within(rowOf("DIAL-TR8K"));
    expect(open.getByText("Tuesday track group")).toBeVisible();
    expect(open.getByText("@dee_k, @paulo")).toBeVisible();
    expect(open.getByText("2/8")).toBeVisible();
    expect(open.getByRole("button", { name: "Copy link" })).toBeVisible();
    // An active code's code and count read in ink; a spent one, muted.
    expect(open.getByText("DIAL-TR8K")).toHaveClass("text-ink");
    expect(open.getByText("2/8")).toHaveClass("text-ink");
    // Not held: the row's own grid, with none of the held row's dimming.
    expect(open.getByText("DIAL-TR8K").closest(".grid")).toHaveClass(
      "grid",
      "items-baseline",
      "gap-4",
    );
    expect(open.getByText("DIAL-TR8K").closest(".grid")).not.toHaveClass(
      "text-quiet",
    );
    const used = within(rowOf("DIAL-7K3P"));
    expect(used.getByText("No label")).toBeVisible();
    expect(used.getByText("maya@example.com")).toBeVisible();
    // Round 29 #14: USED in `--quiet`, the spent code too, not struck.
    expect(used.getByText("Used")).toHaveClass("text-quiet");
    expect(used.getByText("DIAL-7K3P")).toHaveClass("text-quiet");
    expect(used.getByText("DIAL-7K3P")).not.toHaveClass("line-through");
    expect(used.getByText("1/1")).toHaveClass("text-quiet");
    expect(used.queryByRole("button")).toBeNull();
    expect(rowOf("DIAL-7K3P")).toHaveAttribute("data-state", "spent");
    const revoked = within(rowOf("DIAL-H2XN"));
    // A revoked code at the foot reads as it did while held (round 29 #5).
    expect(revoked.getByText("Revoked")).toHaveClass("text-quiet");
    expect(revoked.getByText("DIAL-H2XN")).toHaveClass(
      "text-quiet",
      "line-through",
    );
    expect(revoked.getByText("DIAL-H2XN").closest(".grid")).toHaveClass(
      "text-quiet",
    );
    expect(revoked.queryByRole("button")).toBeNull();
    expect(open.getByText("DIAL-TR8K")).not.toHaveClass("line-through");
    expect(revoked.getByText("Not used yet")).toBeVisible();
    expect(rowOf("DIAL-TR8K")).not.toHaveAttribute("data-state");
    // No revoke has failed, so no row carries its band.
    expect(screen.queryByText("Still active")).toBeNull();
  });

  it("copies the code's link and says so", async () => {
    const { props, user } = desk();
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Copy link" }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Link copied.",
      );
    });
    expect(props.copy).toHaveBeenCalledWith(
      "https://dialed.run/join?code=DIAL-TR8K",
    );
  });

  it("shows the link selected on its row when the browser will not copy (round 28 #9)", async () => {
    const { user } = desk({ copy: () => Promise.reject(new Error("denied")) });
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Copy link" }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Link not copied.",
      );
    });
    const band = within(rowOf("DIAL-TR8K"))
      .getByText(/^Copying/u)
      .closest("[data-part='failure-band']");
    expect(band).toHaveTextContent(
      "Not copiedCopying didn't work here. The link is selected: copy it yourself.",
    );
    const link = within(rowOf("DIAL-TR8K")).getByRole("textbox", {
      name: "Invite link",
    });
    expect(link).toHaveValue("https://dialed.run/join?code=DIAL-TR8K");
    expect(link).toHaveAttribute("readonly");
    if (!(link instanceof HTMLInputElement)) throw new Error("not an input");
    expect(link.selectionStart).toBe(0);
    expect(link.selectionEnd).toBe(link.value.length);
    // No Try again: the same press would fail the same way.
    expect(
      within(rowOf("DIAL-TR8K")).queryByRole("button", { name: "Try again" }),
    ).toBeNull();
    // Only that row, and gone once a copy works.
    expect(
      screen.getAllByRole("textbox", { name: "Invite link" }),
    ).toHaveLength(1);
  });

  it("forgets the selected link once a copy works", async () => {
    const copy = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce();
    const { user } = desk({ copy });
    const copyButton = within(rowOf("DIAL-TR8K")).getByRole("button", {
      name: "Copy link",
    });
    await user.click(copyButton);
    await screen.findByRole("textbox", { name: "Invite link" });
    await user.click(copyButton);
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Invite link" })).toBeNull();
    });
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Link copied.");
  });

  it("revokes at once, the row staying put with REVOKED and Undo, which puts the code back (round 28 #9)", async () => {
    const { props, user } = desk();
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Revoke" }),
    );
    expect(props.revoke).toHaveBeenCalledWith({ data: { id: "c1" } });
    const held = within(rowOf("DIAL-TR8K"));
    // From T1 roles, never opacity (D-92; round 29 #5): the code struck
    // through in `--quiet`, REVOKED in `--quiet`, Undo ink and semibold.
    expect(held.getByText("Revoked")).toHaveClass("text-quiet");
    expect(held.getByText("DIAL-TR8K")).toHaveClass(
      "text-quiet",
      "line-through",
    );
    expect(held.getByRole("button", { name: "Undo" })).toHaveClass(
      "font-semibold",
      "text-ink",
      "underline",
    );
    expect(held.getByText("2/8")).toHaveClass("text-quiet");
    expect(rowOf("DIAL-TR8K").querySelector("[style*='opacity']")).toBeNull();
    expect(held.getByText("DIAL-TR8K").closest(".grid")).toHaveClass(
      "text-quiet",
    );
    expect(held.queryByRole("button", { name: "Copy link" })).toBeNull();
    // No countdown digits anywhere on the row.
    expect(rowOf("DIAL-TR8K")).not.toHaveTextContent(/\ds\b/u);
    await user.click(held.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(props.restore).toHaveBeenCalledWith({ data: { id: "c1" } });
    });
    expect(
      within(rowOf("DIAL-TR8K")).queryByRole("button", { name: "Undo" }),
    ).toBeNull();
  });

  it("says STILL REVOKED under a held row whose Undo fails, keeps its Undo, and retries it (round 29 #14)", async () => {
    vi.useFakeTimers();
    const restore = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    const onChanged = vi.fn(() => Promise.resolve());
    desk({ restore, onChanged });
    act(() => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Revoke" })
        .click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Undo" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const band = within(rowOf("DIAL-TR8K"))
      .getByText("Still revoked")
      .closest("[data-part='failure-band']");
    expect(band).toHaveTextContent("Undo didn't go through. Try again?");
    expect(screen.getAllByRole("status")[0]).toHaveTextContent(
      "Still revoked. Undo didn't go through. Try again?",
    );
    expect(within(rowOf("DIAL-7K3P")).queryByText("Still revoked")).toBeNull();
    // Nothing optimistic: the row is still held, Undo and all, and its ten
    // seconds do not take it away while the band is up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    });
    expect(undo()).not.toBeNull();
    expect(within(rowOf("DIAL-TR8K")).getByText("Still revoked")).toBeVisible();
    const reloads = onChanged.mock.calls.length;
    await act(async () => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Try again" })
        .click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenLastCalledWith({ data: { id: "c1" } });
    expect(onChanged.mock.calls).toHaveLength(reloads + 1);
    expect(undo()).toBeNull();
    expect(screen.queryByText("Still revoked")).toBeNull();
  });

  it("announces a failed revoke in the page's status region", async () => {
    const revoke = vi.fn().mockRejectedValueOnce(new Error("down"));
    const { user } = desk({ revoke });
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Revoke" }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Still active. Revoke didn't go through. Try again?",
      );
    });
  });

  it("arms no Undo timer while nothing is held", async () => {
    // With no row held, the hold's clear-after-ten-seconds timer must not
    // start: it would only clear a hold that is already empty, so nothing
    // on screen shows it, but it is a timer left running for no row.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    desk();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      setTimeoutSpy.mock.calls.filter(([, delay]) => delay === UNDO_WINDOW_MS),
    ).toStrictEqual([]);
    setTimeoutSpy.mockRestore();
  });

  it("drops the Undo after ten seconds, and not before", async () => {
    vi.useFakeTimers();
    desk();
    act(() => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Revoke" })
        .click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1);
    });
    expect(undo()).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(undo()).toBeNull();
    expect(UNDO_WINDOW_MS).toBe(10_000);
  });

  it("says STILL ACTIVE on the row when a revoke fails, keeps the code live, and retries it", async () => {
    vi.useFakeTimers();
    const revoke = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    desk({ revoke });
    await act(async () => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Revoke" })
        .click();
      await vi.advanceTimersByTimeAsync(0);
    });
    const band = within(rowOf("DIAL-TR8K"))
      .getByText("Still active")
      .closest("[data-part='failure-band']");
    expect(band).toHaveTextContent("Revoke didn't go through. Try again?");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    // A failed revoke's band is not timed away with the Undo's ten seconds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    });
    expect(within(rowOf("DIAL-TR8K")).getByText("Still active")).toBeVisible();
    await act(async () => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Try again" })
        .click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenLastCalledWith({ data: { id: "c1" } });
    expect(within(rowOf("DIAL-TR8K")).queryByText("Still active")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" })).toBeVisible();
  });

  it("puts a failed revoke's band only on that row, never on an untouched sibling", async () => {
    const revoke = vi.fn().mockRejectedValueOnce(new Error("down"));
    const { user } = desk({ revoke });
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Revoke" }),
    );
    await waitFor(() => {
      expect(
        within(rowOf("DIAL-TR8K")).getByText("Still active"),
      ).toBeVisible();
    });
    // The band's condition is `code.id === holding`, not "some revoke
    // failed" — a sibling row with no revoke of its own must not wear it.
    expect(within(rowOf("DIAL-7K3P")).queryByText("Still active")).toBeNull();
    expect(within(rowOf("DIAL-H2XN")).queryByText("Still active")).toBeNull();
  });

  it("never re-arms Undo's timer once a revoke has failed, however late the failure lands", async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<undefined>();
    const revoke = vi.fn(() => pending.promise);
    desk({ revoke });
    act(() => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Revoke" })
        .click();
    });
    // The failure lands after Undo's own timer has already been armed
    // (from the revoke), but well before that timer would fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      pending.reject(new Error("down"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(within(rowOf("DIAL-TR8K")).getByText("Still active")).toBeVisible();
    // Ten seconds from the click — when Undo's timer would have fired had
    // the failure never cancelled it — the band is still up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(within(rowOf("DIAL-TR8K")).getByText("Still active")).toBeVisible();
    // And so is ten seconds after the failure itself, which a guard that
    // forgot to check "has this revoke failed" would re-arm the timer from.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(within(rowOf("DIAL-TR8K")).getByText("Still active")).toBeVisible();
  });

  it("leaves no timer pending that could clear a held row once its revoke has failed", async () => {
    vi.useFakeTimers();
    const revoke = vi.fn().mockRejectedValueOnce(new Error("down"));
    desk({ revoke });
    await act(async () => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Revoke" })
        .click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(within(rowOf("DIAL-TR8K")).getByText("Still active")).toBeVisible();
    // Run every timer left pending to completion, however many there are
    // or whenever they fire. The real guard leaves none once a revoke has
    // failed; a guard that stopped checking isFailed on the dependency
    // change would re-arm a clear-the-hold timer instead of returning
    // early, and running it out would clear the hold.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(within(rowOf("DIAL-TR8K")).getByText("Still active")).toBeVisible();
  });

  it("wears no NEW badge before any code has been made this load", () => {
    // A code that happens to share Stryker's own placeholder string: if the
    // "codes made this load" list ever started with anything in it instead
    // of empty, this is the row that would wrongly wear NEW from the start.
    const planted = code({ id: "c9", code: "Stryker was here" });
    desk({ desk: { ...DESK, codes: [planted, ...DESK.codes] } });
    expect(within(rowOf("Stryker was here")).queryByText("New")).toBeNull();
  });

  it("creates a code with a label and uses, once per key, and says which", async () => {
    const createCode = vi.fn(() => Promise.resolve({ code: "DIAL-NEW2" }));
    const { props, user } = desk({ createCode });
    expect(screen.getByLabelText("Uses")).toHaveValue("1");
    await user.type(screen.getByLabelText("Label · for you only"), "Sister");
    await user.clear(screen.getByLabelText("Uses"));
    await user.type(screen.getByLabelText("Uses"), "3");
    await user.click(screen.getByRole("button", { name: "Create code" }));
    // Made and copied at once, said over the list (round 28 #9).
    await waitFor(() => {
      expect(part("status-line")).toHaveTextContent(
        "DIAL-NEW2 made · link copied",
      );
    });
    expect(part("status-line")).toHaveAttribute("role", "status");
    expect(props.copy).toHaveBeenCalledWith(
      "https://dialed.run/join?code=DIAL-NEW2",
    );
    // The form's own status region, distinct from the desk-wide one above.
    await waitFor(() => {
      expect(screen.getAllByRole("status")[1]).toHaveTextContent(
        "Code created.",
      );
    });
    expect(createCode).toHaveBeenCalledWith({
      data: { label: "Sister", maxUses: 3, idempotencyKey: ANY_STRING },
    });
    expect(props.onChanged).toHaveBeenCalled();
    expect(screen.getByLabelText("Label · for you only")).toHaveValue("");
    expect(screen.getByLabelText("Uses")).toHaveValue("1");
    await user.click(screen.getByRole("button", { name: "Create code" }));
    await waitFor(() => {
      expect(createCode).toHaveBeenCalledTimes(2);
    });
    // Isolated to the key itself: the other fields differ between calls
    // too (the form reset), which would mask a key that never rotated.
    const idempotencyKeys = createCode.mock.calls.map((call: unknown[]) => {
      const [arg] = call as [{ data: { idempotencyKey: string } }];
      return arg.data.idempotencyKey;
    });
    expect(idempotencyKeys[0]).not.toBe(idempotencyKeys[1]);
  });

  it("tags a code made on this page NEW, dates every code, and shows the link when the copy fails", async () => {
    const fresh = code({
      id: "c9",
      code: "DIAL-NEW2",
      createdAt: 3 * 24 * 3600 - 30,
      usedBy: [],
    });
    const { user } = desk({
      desk: { ...DESK, codes: [fresh, ...DESK.codes] },
      copy: () => Promise.reject(new Error("denied")),
    });
    expect(within(rowOf("DIAL-NEW2")).queryByText("New")).toBeNull();
    expect(within(rowOf("DIAL-NEW2")).getByText("now")).toBeVisible();
    expect(within(rowOf("DIAL-TR8K")).getByText("3d")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create code" }));
    await waitFor(() => {
      expect(part("status-line")).toHaveTextContent("DIAL-NEW2 made");
    });
    expect(part("status-line")).not.toHaveTextContent("link copied");
    const row = within(rowOf("DIAL-NEW2"));
    expect(row.getByText("New")).toHaveClass("bg-hi-viz", "text-accent-ink");
    expect(row.getByRole("textbox", { name: "Invite link" })).toHaveValue(
      "https://dialed.run/join?code=DIAL-NEW2",
    );
    expect(within(rowOf("DIAL-TR8K")).queryByText("New")).toBeNull();
  });

  it("names both fields by their labels in the summary when both are wrong", async () => {
    const { user } = desk();
    await user.type(
      screen.getByLabelText("Label · for you only"),
      "x".repeat(61),
    );
    await user.clear(screen.getByLabelText("Uses"));
    await user.type(screen.getByLabelText("Uses"), "0");
    await user.click(screen.getByRole("button", { name: "Create code" }));
    expect(
      await screen.findByRole("button", { name: /Label · for you only/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Uses/ })).toBeVisible();
  });

  it("refuses a uses limit that is not a whole number from 1 to 100", async () => {
    const { props, user } = desk();
    await user.clear(screen.getByLabelText("Uses"));
    await user.type(screen.getByLabelText("Uses"), "0");
    await user.click(screen.getByRole("button", { name: "Create code" }));
    expect(
      await screen.findByText("Use a whole number from 1 to 100."),
    ).toBeVisible();
    expect(props.createCode).not.toHaveBeenCalled();
  });
});

describe("D7's labels", () => {
  it("draws an age as round 28 #9 does: now, minutes, hours, days, then a date", () => {
    expect(ageLabel(0, 0)).toBe("now");
    expect(ageLabel(0, 59)).toBe("now");
    expect(ageLabel(100, 0)).toBe("now");
    expect(ageLabel(0, 60)).toBe("1m");
    expect(ageLabel(0, 3599)).toBe("59m");
    expect(ageLabel(0, 3600)).toBe("1h");
    expect(ageLabel(0, 3600 * 24 - 1)).toBe("23h");
    expect(ageLabel(0, 3600 * 24)).toBe("1d");
    const DAY = 3600 * 24;
    expect(ageLabel(0, DAY * 30 - 1)).toBe("29d");
    // 2026-08-29, thirty days before the asOf: a date, in UTC.
    const aug29 = Math.floor(Date.UTC(2026, 7, 29, 12) / 1000);
    expect(ageLabel(aug29, aug29 + DAY * 30)).toBe("Aug 29");
  });

  it("keeps revoked codes at the foot, except the one whose Undo is showing", () => {
    const fresh = code({ id: "a" });
    const revoked = code({ id: "b", isRevoked: true });
    const later = code({ id: "c" });
    expect(
      orderedCodes([fresh, revoked, later], undefined).map((c) => c.id),
    ).toStrictEqual(["a", "c", "b"]);
    expect(
      orderedCodes([fresh, revoked, later], "b").map((c) => c.id),
    ).toStrictEqual(["a", "b", "c"]);
  });

  it("says a made code, and whether its link was copied", () => {
    expect(madeLine("DIAL-7QX2", true)).toBe("DIAL-7QX2 made · link copied");
    expect(madeLine("DIAL-7QX2", false)).toBe("DIAL-7QX2 made");
  });

  it("counts a code active while it has a use left and is not revoked", () => {
    expect(
      codeCounts([
        code({ maxUses: 2, usedBy: ["@a"] }),
        code({ maxUses: 1, usedBy: ["@b"] }),
        code({ isRevoked: true, usedBy: [] }),
      ]),
    ).toBe("1 active · 2 used");
  });
});
