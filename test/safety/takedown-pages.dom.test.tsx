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
  await user.type(screen.getByLabelText("Full name"), "Sam Runner");
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

type DecideFn = Parameters<typeof RemovalRequests>[0]["decide"];
type BlockFn = Parameters<typeof RemovalRequests>[0]["block"];

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
    otherPhotos: [],
    ...overrides,
  };
}

describe("Review · removal requests", () => {
  it("names the subject, then the clock right, who signed, what they said, and opens the kit (round 35 #58e)", async () => {
    await renderWithRouter(
      <RemovalRequests
        requests={[pending({ description: "a photo of me" })]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    const row = part("removal-request");
    expect(row).toHaveTextContent(
      /^entry\[via \/takedown\]\[hidden\]Due in 31h/u,
    );
    // The clock in the header, uppercase in CSS, as a queue row's.
    const clock = part("due");
    expect(clock).toHaveTextContent(/^Due in 31h$/u);
    expect(clock).toHaveClass("uppercase");
    expect(clock?.firstElementChild).toHaveClass("font-mono");
    expect(row).toHaveTextContent("From Sam Runner · signed · good faith");
    expect(row?.querySelector("q")).toHaveTextContent(/^a photo of me$/u);
    expect(row).toHaveTextContent("sam@example.com");
    const open = screen.getByRole("link", { name: "Open the kit" });
    expect(open).toHaveAttribute("href", `/feed/entry/${ENTRY}`);
    expect(open).toHaveClass("target");
    expect(screen.getByText("Removal requests · 1")).toBeInTheDocument();
  });

  it("leaves out the description's line when there is none", async () => {
    await renderWithRouter(
      <RemovalRequests
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
      `/feed/entry/${ENTRY}`,
    );
    expect(
      screen.getByText("Not one of our links: find it from what they wrote."),
    ).toBeVisible();
    // The link as given, and a header that names no subject.
    const [photo, outside] = document.querySelectorAll<HTMLElement>(
      "[data-part='removal-request']",
    );
    expect(photo).toHaveTextContent(/^photo\[via \/takedown\]/u);
    expect(outside).toHaveTextContent(/^link\[via \/takedown\]/u);
    expect(outside).toHaveTextContent("somewhere");
  });

  it("takes it down, says so, and only that request leaves the list", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests
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

  it("declines only with a reason, asked for once Decline is pressed, and sends it", async () => {
    const decide = vi.fn<DecideFn>().mockResolvedValue({ outcome: "decided" });
    await renderWithRouter(
      <RemovalRequests
        requests={[pending()]}
        decide={decide}
        block={vi.fn<BlockFn>()}
      />,
    );
    const user = userEvent.setup();
    // Decline is a text button until pressed: then it asks for the line.
    expect(screen.queryByLabelText("Why not")).toBeNull();
    const ask = screen.getByRole("button", { name: "Decline" });
    expect(ask).toHaveAttribute("type", "button");
    await user.click(ask);
    expect(
      screen.getByText("The person who asked is sent this."),
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
        requests={[pending({ holdState: undefined })]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("hold-state")).toBeNull();
    expect(part("related")).toBeNull();
  });

  it("names the requester's other open requests", async () => {
    await renderWithRouter(
      <RemovalRequests
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

    await user.click(
      row.getByRole("button", { name: "Block and decline all" }),
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

  it("takes focus only from script: a row is not a tab stop", async () => {
    await renderWithRouter(
      <RemovalRequests
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

  it("names the poster in the line for a link that is not ours (round 37 #59g)", async () => {
    await renderWithRouter(
      <RemovalRequests
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
        requests={[]}
        decide={vi.fn<DecideFn>()}
        block={vi.fn<BlockFn>()}
      />,
    );
    expect(part("removal-request")).toBeNull();
    expect(screen.queryByText(/Removal requests/u)).toBeNull();
  });
});
