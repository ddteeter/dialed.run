import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TURNSTILE_REFUSED } from "../../src/lib/contracts/access";
import { shortId } from "../../src/modules/safety/components/short-id";
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
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

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

/**
Whether `a` comes before `b` in the page: the order a reader meets them.
*/
function isBefore(a: Node, b: Node): boolean {
  return (
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

/**
The request rows as drawn now.
*/
function rows(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-part='removal-request']"),
  ];
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

/**
`expect.stringMatching` is typed `any`; `unknown` keeps it out of no-unsafe-assignment.
*/
const A_KEY: unknown = expect.stringMatching(/^[0-9A-Z]{26}$/u);

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Email"), "sam@example.com");
  await user.type(screen.getByLabelText("Full name"), "Sam Runner");
  await user.type(
    screen.getByLabelText("Link to the image"),
    "https://dialed.run/feed/entry/x",
  );
  await user.type(screen.getByLabelText("What it shows · optional"), "me");
  await user.click(screen.getByLabelText(ATTESTATION));
}

type RequestFn = Parameters<typeof TakedownRequest>[0]["request"];

describe("/takedown", () => {
  it("starts with the link a public kit's Report this kit hands it", async () => {
    await renderWithRouter(
      <TakedownRequest
        siteKey={undefined}
        request={vi.fn<RequestFn>()}
        location="https://dialed.run/kit/01JABCDEFGHJKMNPQRSTVWXYZ0"
      />,
    );

    expect(screen.getByLabelText("Link to the image")).toHaveValue(
      "https://dialed.run/kit/01JABCDEFGHJKMNPQRSTVWXYZ0",
    );
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("starts empty with no link handed in", async () => {
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );

    expect(screen.getByLabelText("Link to the image")).toHaveValue("");
  });

  it("says what happens, and asks for the four parts of a request", async () => {
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Ask us to remove an image",
      }),
    ).toBeVisible();
    // Round 35 #58e's lead, and its grey field words as hints.
    expect(
      screen.getByText(
        "For an intimate image of you, or someone you act for, shared without consent. We hide it while we look and decide within 48 hours.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Where we'll write back")).toBeVisible();
    expect(
      screen.getByText("A dialed.run link, or say where it is."),
    ).toBeVisible();
    expect(screen.getByText("One line")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Full name")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    expect(screen.getByText("Typed as your signature.")).toBeVisible();
    // Round 37 #59g: who posted it, after the link, optional.
    expect(
      screen.getByLabelText("Their dialed.run username · optional"),
    ).toBeVisible();
    expect(screen.getByText("If you know who posted it.")).toBeVisible();
    // Words are allowed, so not a URL field (no space bar on a phone's).
    expect(screen.getByLabelText("Link to the image")).toHaveAttribute(
      "type",
      "text",
    );
    expect(screen.getByLabelText(ATTESTATION)).not.toBeChecked();
    expect(ATTESTATION).toBe(
      "I believe in good faith this image was shared without consent, and I'm the person in it or acting for them.",
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
    await user.click(screen.getByRole("button", { name: "Send the request" }));

    expect(await screen.findByText("Request sent.")).toBeInTheDocument();
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
        posterUsername: undefined,
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
    expect(
      receipt?.querySelector("[data-part='elsewhere-help']"),
    ).toBeVisible();
    expect(part("form")).toBeNull();
  });

  it("sends the poster's username as a handle, its @ and case forgiven (round 37 #59g)", async () => {
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await fillIn(user);
    await user.type(
      screen.getByLabelText("Their dialed.run username · optional"),
      "@Maya_Runs",
    );
    await user.click(screen.getByRole("button", { name: "Send the request" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalled();
    });
    expect(request.mock.calls[0]?.[0].data.posterUsername).toBe("maya_runs");
  });

  it("reads a username of only spaces as none given", async () => {
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await fillIn(user);
    await user.type(
      screen.getByLabelText("Their dialed.run username · optional"),
      " ".repeat(3),
    );
    await user.click(screen.getByRole("button", { name: "Send the request" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalled();
    });
    expect(request.mock.calls[0]?.[0].data.posterUsername).toBeUndefined();
  });

  it("says what is wrong with a username that cannot be one", async () => {
    const request = vi.fn<RequestFn>();
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await fillIn(user);
    await user.type(
      screen.getByLabelText("Their dialed.run username · optional"),
      "no spaces here",
    );
    await user.click(screen.getByRole("button", { name: "Send the request" }));
    expect(
      await screen.findAllByText("Use 3–20 letters, numbers or _."),
    ).not.toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("sends nothing until the statement is confirmed", async () => {
    const request = vi.fn<RequestFn>();
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={request} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send the request" }));
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
    await user.type(screen.getByLabelText("Full name"), "Sam Runner");
    await user.type(screen.getByLabelText("Link to the image"), "here");
    await user.click(screen.getByRole("button", { name: "Send the request" }));

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
    await user.click(screen.getByRole("button", { name: "Send the request" }));

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
    posterUsername: undefined,
    subject: { subjectType: "entry", subjectId: ENTRY, entryId: ENTRY },
    createdAt: 1,
    dueAt: 2,
    due: "Due in 31h",
    holdState: "held",
    relatedIds: [],
    otherPhotos: { photos: [], total: 0, handle: undefined },
    ...overrides,
  };
}

type DecideFn = Parameters<typeof RemovalRequests>[0]["decide"];

type BlockFn = Parameters<typeof RemovalRequests>[0]["block"];

describe("Review · removal requests", () => {
  it("names the subject, then the clock right, who signed, what they said, and opens the kit (round 35 #58e)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending({ description: "a photo of me" })]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    const row = part("removal-request");
    // R55·197: the queue row's head, a --panel card, the clock at its right
    // in bold hi-viz, uppercase in CSS.
    expect(row).toHaveClass("rounded-card", "bg-panel");
    const head = part("request-head");
    expect(head).toHaveTextContent(
      `entry · ${shortId(ENTRY)} [via /takedown] [hidden]`,
    );
    expect(head).toHaveAttribute("title", ENTRY);
    const clock = screen.getByText("Due in 31h");
    expect(clock).toHaveClass("font-mono", "uppercase", "text-hiviz-text");
    expect(clock).not.toHaveClass("bg-hi-viz");
    expect(part("request-body")).toHaveClass("border-t");
    expect(part("request-bar")).toHaveClass("border-t");
    expect(row).toHaveTextContent("From Sam Runner · signed · good faith");
    expect(row?.querySelector("q")).toHaveTextContent(/^a photo of me$/u);
    expect(row).toHaveTextContent("sam@example.com");
    const open = screen.getByRole("link", { name: "Open the kit" });
    // Round 51 · 153: the kit's back link returns to this request.
    expect(open).toHaveAttribute(
      "href",
      `/desk/kit/${ENTRY}?from=request&row=01JREQUEST0000000000000001`,
    );
    expect(row).toHaveAttribute("id", "request-01JREQUEST0000000000000001");
    expect(open).toHaveClass("target");
    expect(screen.getByText("Removal requests · 1")).toBeInTheDocument();
  });

  it("focuses the request a kit was opened from, back from it (round 52 #155.5)", async () => {
    globalThis.location.hash = "#request-01JREQUEST0000000000000001";
    try {
      await renderWithRouter(
        <RemovalRequests
          asOf={0}
          requests={[pending()]}
          decide={vi.fn<DecideFn>()}
          block={vi.fn<BlockFn>()}
        />,
      );
      expect(part("removal-request")).toHaveFocus();
    } finally {
      globalThis.location.hash = "";
    }
  });

  it("leaves out the description's line when there is none", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("removal-request")?.querySelector("q")).toBeNull();
  });

  it("opens a reported photo's kit, and says when a link is not ours", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
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
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(screen.getByRole("link", { name: "Open its kit" })).toHaveAttribute(
      "href",
      `/desk/kit/${ENTRY}?from=request&row=01JREQUEST0000000000000002`,
    );
    expect(
      screen.getByText("Not one of our links: find it from what they wrote."),
    ).toBeVisible();
    // The link as given, and a header that names no subject.
    const [photo, outside] = document.querySelectorAll<HTMLElement>(
      "[data-part='removal-request']",
    );
    expect(photo).toHaveTextContent(/^photo · \S+ \[via \/takedown\]/u);
    expect(outside).toHaveTextContent(/^link \[via \/takedown\]/u);
    expect(outside).toHaveTextContent("somewhere");
  });

  it("draws an overdue request's clock as the filled tag, and names the poster (R55·197)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={5}
        requests={[pending({ due: "Overdue", posterUsername: "tomasz_k" })]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(screen.getByText("Overdue")).toHaveClass(
      "bg-hi-viz",
      "text-accent-ink",
    );
    expect(part("request-head")).toHaveTextContent(
      `entry · ${shortId(ENTRY)} · @tomasz_k [via /takedown]`,
    );
  });

  it("takes it down, says so, and only that request leaves the list", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[
          pending(),
          pending({
            id: "01JREQUEST0000000000000009",
            signature: "Other Asker",
          }),
        ]}
        decide={decide}
        block={vi.fn<BlockFn>()}
      />,
    );
    const [first] = document.querySelectorAll<HTMLElement>(
      "[data-part='removal-request']",
    );
    await userEvent.setup().click(
      within(first ?? document.body).getByRole("button", {
        name: "Take it down",
      }),
    );
    expect(await screen.findByText("Removed.")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-part='removal-request']"),
      ).toHaveLength(1);
    });
    expect(part("removal-request")).toHaveTextContent("Other Asker");
    expect(screen.getByText("Removal requests · 1")).toBeInTheDocument();
    expect(decide).toHaveBeenCalledWith({
      data: { requestId: "01JREQUEST0000000000000001", outcome: "removed" },
    });
  });

  it("draws its decisions as one bar, Take it down first, and Block's question in its place (round 44)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    const bar = part("request-actions");
    expect(bar).toHaveClass("flex", "flex-wrap", "items-center", "gap-3");
    const press = (name: string): HTMLElement =>
      within(bar ?? document.body).getByRole("button", { name });
    expect(isBefore(press("Take it down"), press("Decline"))).toBe(true);
    expect(isBefore(press("Decline"), press("Block and decline all"))).toBe(
      true,
    );

    // Block's question takes the bar's place, its answer then Cancel in a row.
    await user.click(press("Block and decline all"));
    expect(part("request-actions")).toBeNull();
    const question = within(part("block") ?? document.body);
    const confirm = question.getByRole("button", {
      name: "Block and decline all",
    });
    const cancel = question.getByRole("button", { name: "Cancel" });
    expect(confirm.parentElement).toBe(cancel.parentElement);
    expect(confirm.parentElement).toHaveClass("flex", "flex-wrap");
    expect(isBefore(confirm, cancel)).toBe(true);
    // Cancel brings the bar back, all three in it.
    await user.click(cancel);
    const again = within(part("request-actions") ?? document.body);
    for (const name of ["Take it down", "Decline", "Block and decline all"]) {
      expect(again.getByRole("button", { name })).toBeVisible();
    }
  });

  it("puts a failed Take it down's band above the bar, the bar still one row (P3-01)", async () => {
    const decide = vi
      .fn<DecideFn>()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={decide}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Take it down" }));

    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found ?? document.body;
    });
    const bar = part("request-actions") ?? document.body;
    expect(isBefore(band, bar)).toBe(true);
    expect(bar).not.toContainElement(band);
    for (const name of ["Take it down", "Decline", "Block and decline all"]) {
      expect(within(bar).getByRole("button", { name })).toBeVisible();
    }
  });

  it("wraps a long requester address rather than cutting it (P3-05)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("requester")).toHaveTextContent(/^sam@example\.com$/u);
    expect(part("requester")).toHaveClass("wrap-anywhere");
  });

  it("asks why not in the bar's place, and keeps what was typed through Cancel and Esc (round 45 #107)", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={decide}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Decline" }));

    // The question replaces the bar, and opens on its field.
    expect(part("request-actions")).toBeNull();
    const question = part("decline") ?? document.body;
    expect(question).toHaveTextContent(/^Decline this request/u);
    const field = within(question).getByLabelText("Why not");
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
    const answer = within(question).getByRole("button", { name: "Decline" });
    const cancel = within(question).getByRole("button", { name: "Cancel" });
    expect(answer).toHaveClass("bg-ink", "text-ground", "rounded-pill");
    expect(cancel).toHaveClass("underline");
    expect(answer.parentElement).toBe(cancel.parentElement);
    expect(answer.parentElement).toHaveClass("flex", "flex-wrap");
    expect(isBefore(answer, cancel)).toBe(true);
    expect(cancel).not.toHaveFocus();

    // Cancel draws the bar again, focus on Decline; the reason is kept.
    await user.type(field, "Not theirs to ask about");
    await user.click(cancel);
    expect(part("decline")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Decline" })).toHaveFocus();
    });
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByLabelText("Why not")).toHaveValue(
      "Not theirs to ask about",
    );

    // Esc in the field is Cancel too, and keeps it as well.
    await user.keyboard("{Escape}");
    expect(part("decline")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Decline" })).toHaveFocus();
    });
    await user.click(screen.getByRole("button", { name: "Decline" }));
    // A key that is not Esc leaves the question up.
    await user.keyboard("{Enter}");
    expect(part("decline")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(decide).toHaveBeenCalledWith({
      data: {
        requestId: "01JREQUEST0000000000000001",
        outcome: "declined",
        reason: "Not theirs to ask about",
      },
    });
  });

  it("declines only with a reason, asked for once Decline is pressed, and sends it", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={decide}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    // Decline is an outline pill until pressed: then it asks for the line.
    expect(screen.queryByLabelText("Why not")).toBeNull();
    const ask = screen.getByRole("button", { name: "Decline" });
    expect(ask).toHaveAttribute("type", "button");
    expect(ask).toHaveClass(
      "rounded-pill",
      "border",
      "border-ink",
      "bg-transparent",
      "font-bold",
      "text-ink",
    );
    await user.click(ask);
    expect(
      screen.getByText(
        "The person who asked is sent this. Not nude or sexual? Say so.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Decline" })).toHaveAttribute(
      "type",
      "submit",
    );
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(
      await screen.findAllByText("Say why, for the person who asked."),
    ).not.toHaveLength(0);
    expect(decide).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Why not"), "shoes");
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined.")).toBeInTheDocument();
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

  it.each([
    ["held", "[hidden]"],
    ["confirm", "[unconfirmed]"],
    ["valve", "[valve shut]"],
    ["blocked", "[blocked]"],
  ] as const)(
    "says what filing decided, %s (design 137)",
    async (holdState, words) => {
      await renderWithRouter(
        <RemovalRequests
          asOf={0}
          requests={[pending({ holdState })]}
          decide={vi.fn<DecideFn>()}
          block={vi.fn<BlockFn>()}
        />,
      );
      expect(part("hold-state")).toHaveTextContent(words);
    },
  );

  it("says nothing of a hold for a link that hides nothing, nor of others when there are none", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending({ holdState: undefined })]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("hold-state")).toBeNull();
    expect(part("related")).toBeNull();
  });

  it("says what intimate means on every request (D-161)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("statutory-line")).toHaveTextContent(
      "Intimate means nudity or sexual content (15 U.S.C. § 6851). If it isn't, decline, and remove it under another rule if it breaks one.",
    );
  });

  it("names the requester's other open requests", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending({ relatedIds: ["a", "b"] })]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("related")).toHaveTextContent(/^2 more from this requester$/u);
  });

  it("asks before it blocks, can be cancelled, and takes every request of theirs off the list", async () => {
    const block = vi.fn<BlockFn>().mockResolvedValue({ status: "blocked" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[
          pending({
            id: "01JABCDEFGHJKMNPQRSTVWXYZ1",
            relatedIds: ["01JABCDEFGHJKMNPQRSTVWXYZ2"],
          }),
          pending({
            id: "01JABCDEFGHJKMNPQRSTVWXYZ2",
            relatedIds: ["01JABCDEFGHJKMNPQRSTVWXYZ1"],
          }),
          pending({
            id: "01JABCDEFGHJKMNPQRSTVWXYZ3",
            signature: "Someone Else",
          }),
        ]}
        decide={vi.fn<DecideFn>()}
        block={block}
      />,
    );
    const user = userEvent.setup();
    const [first] = document.querySelectorAll<HTMLElement>(
      "[data-part='removal-request']",
    );
    const row = within(first ?? document.body);

    expect(
      row.getByRole("button", { name: "Block and decline all" }),
    ).toHaveClass(
      "rounded-pill",
      "border",
      "border-ink",
      "bg-transparent",
      "font-bold",
      "text-ink",
    );
    await user.click(
      row.getByRole("button", { name: "Block and decline all" }),
    );
    expect(row.getByRole("button", { name: "Cancel" })).toHaveClass(
      "border-none",
      "bg-transparent",
      "text-ink",
      "underline",
      "underline-offset-4",
    );
    expect(
      row.getByText(
        "Block this requester and decline all 2 of their requests? Anything they hid comes back, and nothing is sent to them.",
      ),
    ).toBeVisible();
    await user.click(row.getByRole("button", { name: "Cancel" }));
    expect(part("block")).toBeNull();
    expect(block).not.toHaveBeenCalled();

    await user.click(
      row.getByRole("button", { name: "Block and decline all" }),
    );
    const submit = row.getByRole("button", { name: "Block and decline all" });
    expect(submit).toHaveAttribute("type", "submit");
    await user.click(submit);
    expect(
      await screen.findByText("Blocked. 2 requests declined."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-part='removal-request']"),
      ).toHaveLength(1);
    });
    expect(part("removal-request")).toHaveTextContent("Someone Else");
    expect(block).toHaveBeenCalledWith({
      data: { requestId: "01JABCDEFGHJKMNPQRSTVWXYZ1" },
    });
  });

  it("asks about the one request when the requester has no other", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Block and decline all" }));
    expect(
      screen.getByText(
        "Block this requester and decline this request? Anything they hid comes back, and nothing is sent to them.",
      ),
    ).toBeVisible();
  });

  it("opens the question on Cancel, and Cancel or Esc hands focus back (round 37 #59f)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    const ask = () =>
      screen.getByRole("button", { name: "Block and decline all" });

    await user.click(ask());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(ask()).toHaveFocus();
    });

    await user.click(ask());
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(ask()).toHaveFocus();
    });
    expect(part("block")).toBeNull();
  });

  it("keeps the question open for a key that is not Esc", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Block and decline all" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    });
    await user.keyboard("a");
    expect(part("block")).not.toBeNull();
  });

  it("hands focus back on Cancel even when the click that asked did not take it", async () => {
    // Safari does not focus a button on click, so the button that asked
    // may not hold focus when it leaves; Cancel still returns there.
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Block and decline all" }),
    );
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Block and decline all" }),
      ).toHaveFocus();
    });
  });

  it("hands focus back to Decline on Cancel even when the click did not take it", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    // Focus left on the page, as Safari leaves it, not on the field.
    const active = globalThis.document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Decline" })).toHaveFocus();
    });
  });

  it.each([
    ["Block and decline all", "Blocking"],
    ["Decline", "Declining"],
  ])("names %s's answer by its in-flight verb, %s", async (press, verb) => {
    const never = Promise.withResolvers<never>().promise;
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending({ id: "01JABCDEFGHJKMNPQRSTVWXYZ1" })]}
        decide={vi.fn<DecideFn>().mockReturnValue(never)}
        block={vi.fn<BlockFn>().mockReturnValue(never)}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: press }));
    if (press === "Decline") {
      await user.type(screen.getByLabelText("Why not"), "Not theirs");
    }
    const question = part(press === "Decline" ? "decline" : "block");
    const answer = within(question ?? document.body).getByRole("button", {
      name: press,
    });
    await user.click(answer);
    await waitFor(() => {
      expect(answer).toHaveAccessibleName(verb);
    });
  });

  it("takes focus only from script: a row is not a tab stop", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("removal-request")).toHaveAttribute("tabindex", "-1");
  });

  it("takes the last request off the list, with nothing left to focus", async () => {
    const block = vi.fn<BlockFn>().mockResolvedValue({ status: "blocked" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending({ id: "01JABCDEFGHJKMNPQRSTVWXYZ1" })]}
        decide={vi.fn<DecideFn>()}
        block={block}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Block and decline all" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Block and decline all" }),
    );
    await waitFor(() => {
      expect(part("removal-request")).toBeNull();
    });
    expect(block).toHaveBeenCalledOnce();
  });

  it("says one request declined, and moves focus to the next request left", async () => {
    const block = vi.fn<BlockFn>().mockResolvedValue({ status: "blocked" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[
          pending({ id: "01JABCDEFGHJKMNPQRSTVWXYZ1" }),
          pending({
            id: "01JABCDEFGHJKMNPQRSTVWXYZ2",
            signature: "Next Asker",
          }),
        ]}
        decide={vi.fn<DecideFn>()}
        block={block}
      />,
    );
    const user = userEvent.setup();
    const [first] = document.querySelectorAll<HTMLElement>(
      "[data-part='removal-request']",
    );
    const row = within(first ?? document.body);
    await user.click(
      row.getByRole("button", { name: "Block and decline all" }),
    );
    await user.click(
      row.getByRole("button", { name: "Block and decline all" }),
    );
    expect(
      await screen.findByText("Blocked. 1 request declined."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(part("removal-request")).toHaveFocus();
    });
    expect(part("removal-request")).toHaveTextContent("Next Asker");
    // Focus lands once: a later render of the row leaves it where it is.
    await user.click(screen.getByRole("button", { name: "Decline" }));
    expect(screen.getByLabelText("Why not")).not.toBe(document.body);
    expect(part("removal-request")).not.toHaveFocus();
  });

  it("lands focus once: the list drawn again after another decision leaves it", async () => {
    const block = vi.fn<BlockFn>().mockResolvedValue({ status: "blocked" });
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[
          pending({ id: "01JABCDEFGHJKMNPQRSTVWXYZ1" }),
          pending({ id: "01JABCDEFGHJKMNPQRSTVWXYZ2", signature: "Next" }),
          pending({ id: "01JABCDEFGHJKMNPQRSTVWXYZ3", signature: "Last" }),
        ]}
        decide={decide}
        block={block}
      />,
    );
    const user = userEvent.setup();
    const first = within(rows()[0] ?? document.body);
    await user.click(
      first.getByRole("button", { name: "Block and decline all" }),
    );
    await user.click(
      first.getByRole("button", { name: "Block and decline all" }),
    );
    await waitFor(() => {
      expect(rows()[0]).toHaveFocus();
    });
    const next = rows()[0];
    expect(next).toHaveTextContent("Next");

    // Taking the last one down draws the list again; Next's row does not
    // take focus back.
    await user.click(
      within(rows()[1] ?? document.body).getByRole("button", {
        name: "Take it down",
      }),
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(next).not.toHaveFocus();
  });

  it("names the poster in the line for a link that is not ours (round 37 #59g)", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[
          pending({
            subject: undefined,
            location: "at the finish line",
            posterUsername: "maya_runs",
          }),
        ]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(
      screen.getByText(
        "Not one of our links: find it on @maya_runs's entries from what they wrote.",
      ),
    ).toBeVisible();
  });

  it("renders nothing when nothing is waiting", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("removal-request")).toBeNull();
    expect(screen.queryByText(/Removal requests/u)).toBeNull();
  });
});

describe("takedown pages: a lapsed session (Au7, D-155)", () => {
  it("carries every form on a request, Decline's too, as the page", async () => {
    carriedSince();
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    // Decline's form is asked for only once Decline is pressed.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Decline" }));

    expect(carriedSince()).toEqual(["page"]);
  });

  it("carries Block's question as the page", async () => {
    await renderWithRouter(
      <RemovalRequests
        asOf={0}
        requests={[pending()]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    carriedSince();
    // The question's form is asked for only once Block is pressed.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Block and decline all" }));

    expect(carriedSince()).toEqual(["page"]);
  });

  it("leaves /takedown, open to anyone, carrying nothing", async () => {
    carriedSince();
    await renderWithRouter(
      <TakedownRequest siteKey={undefined} request={vi.fn<RequestFn>()} />,
    );

    expect(carriedSince()).toEqual([undefined]);
  });
});
