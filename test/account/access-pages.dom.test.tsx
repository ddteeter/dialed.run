import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { TURNSTILE_REFUSED } from "../../src/lib/access";
import type { AccessRequestResult } from "../../src/modules/account/access";
import {
  DeskAccess,
  UNDO_WINDOW_MS,
  ageLabel,
  codeCounts,
} from "../../src/modules/account/components/DeskAccess";
import {
  RequestAccess,
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
    expect(screen.getByLabelText("A note · optional")).toBeVisible();
    expect(
      screen.getByText("How you run, or who sent you. Up to 280 characters."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "‹ Create an account" }),
    ).toHaveAttribute("href", "/auth/signup");
  });

  it("sends the request with Turnstile's answer and shows the one receipt", async () => {
    answeringTurnstile("answer");
    const request = vi
      .fn<RequestFn>()
      .mockResolvedValue({ status: "received" });
    await renderWithRouter(<RequestAccess siteKey="site" request={request} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.type(screen.getByLabelText("A note · optional"), "Duluth.");
    await user.click(screen.getByRole("button", { name: "Request access" }));
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
    expect(
      inReceipt.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/auth/signup");
    expect(part("form")).toBeNull();
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
    await user.click(screen.getByRole("button", { name: "Request access" }));
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
    await user.click(screen.getByRole("button", { name: "Request access" }));
    expect(
      await screen.findByText("That does not look like an email address."),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it("names the limit's time, and Turnstile's sentence for its refusal", () => {
    expect(refusalMessage({ status: "refused" })).toBe(TURNSTILE_REFUSED);
    expect(refusalMessage({ status: "limited", until: 0 })).toMatch(
      /^Too many requests from here\. Try again at .+\.$/u,
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
    { id: "r1", email: "sam@example.com", note: "Winter runner.", createdAt: 0 },
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
    const j = within(rowOf("j@example.com"));
    expect(j.getByText("No note.")).toHaveClass("text-muted");
    expect(j.getByText("2d")).toBeVisible();
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

  it("says Not changed when a row action fails, and retries it", async () => {
    const decline = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(undefined);
    const { user } = desk({ decline });
    await user.click(
      within(rowOf("j@example.com")).getByRole("button", { name: "Decline" }),
    );
    const band = await waitFor(() => {
      const found = part("failure-band");
      expect(found).not.toBeNull();
      return found;
    });
    expect(band).toHaveTextContent("Not changed");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(decline).toHaveBeenCalledTimes(2);
    });
    expect(decline).toHaveBeenLastCalledWith({ data: { id: "r2" } });
  });

  it("lists codes with their label, who used them and their uses, and counts them", () => {
    desk();
    expect(screen.getByText("1 active · 3 used")).toBeVisible();
    const open = within(rowOf("DIAL-TR8K"));
    expect(open.getByText("Tuesday track group")).toBeVisible();
    expect(open.getByText("@dee_k, @paulo")).toBeVisible();
    expect(open.getByText("2/8")).toBeVisible();
    expect(open.getByRole("button", { name: "Copy link" })).toBeVisible();
    const used = within(rowOf("DIAL-7K3P"));
    expect(used.getByText("No label")).toBeVisible();
    expect(used.getByText("maya@example.com")).toBeVisible();
    expect(used.getByText("Used")).toBeVisible();
    expect(used.queryByRole("button")).toBeNull();
    expect(rowOf("DIAL-7K3P")).toHaveAttribute("data-state", "spent");
    const revoked = within(rowOf("DIAL-H2XN"));
    expect(revoked.getByText("Revoked")).toBeVisible();
    expect(revoked.getByText("Not used yet")).toBeVisible();
    expect(rowOf("DIAL-TR8K")).not.toHaveAttribute("data-state");
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

  it("says so when the browser will not copy", async () => {
    const { user } = desk({ copy: () => Promise.reject(new Error("denied")) });
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Copy link" }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Link not copied. Your browser refused.",
      );
    });
  });

  it("revokes at once, with an undo for ten seconds that puts the code back", async () => {
    const { props, user } = desk();
    await user.click(
      within(rowOf("DIAL-TR8K")).getByRole("button", { name: "Revoke" }),
    );
    expect(props.revoke).toHaveBeenCalledWith({ data: { id: "c1" } });
    expect(part("undo")).toHaveTextContent("Revoked DIAL-TR8K.");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => {
      expect(props.restore).toHaveBeenCalledWith({ data: { id: "c1" } });
    });
    expect(part("undo")).toBeNull();
  });

  it("drops the undo after ten seconds, and not before", async () => {
    vi.useFakeTimers();
    desk();
    act(() => {
      within(rowOf("DIAL-TR8K"))
        .getByRole("button", { name: "Revoke" })
        .click();
    });
    expect(part("undo")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS - 1);
    });
    expect(part("undo")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(part("undo")).toBeNull();
    expect(UNDO_WINDOW_MS).toBe(10_000);
  });

  it("creates a code with a label and uses, once per key, and says which", async () => {
    const createCode = vi.fn(() => Promise.resolve({ code: "DIAL-NEW2" }));
    const { props, user } = desk({ createCode });
    await user.type(screen.getByLabelText("Label · for you only"), "Sister");
    await user.clear(screen.getByLabelText("Uses"));
    await user.type(screen.getByLabelText("Uses"), "3");
    await user.click(screen.getByRole("button", { name: "Create code" }));
    await waitFor(() => {
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        "Created DIAL-NEW2.",
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
    const keys = createCode.mock.calls.map(
      (call: unknown[]) => JSON.stringify(call),
    );
    expect(keys[0]).not.toBe(keys[1]);
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
  it("draws an age in hours under a day and days after", () => {
    expect(ageLabel(0, 3599)).toBe("0h");
    expect(ageLabel(0, 3600 * 23)).toBe("23h");
    expect(ageLabel(0, 3600 * 24 - 1)).toBe("23h");
    expect(ageLabel(0, 3600 * 24)).toBe("1d");
    expect(ageLabel(100, 0)).toBe("0h");
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
