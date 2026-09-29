import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CURRENT_PASSWORD_WRONG,
  DELETION_GRACE_S,
  currentPasswordLimited,
} from "../../src/lib/contracts";
import { clockLabel, deviceTimeZone, proseDayLabel } from "../../src/lib/dates";
import { nowSeconds } from "../../src/lib/now";
import { DeleteAccount } from "../../src/modules/account/components/DeleteAccount";
import {
  Leaving,
  TOO_LATE,
} from "../../src/modules/account/components/Leaving";
import type {
  DeletionResult,
  KeepResult,
} from "../../src/modules/account/deletion";

/**
 * Round 27 #14's deletion screens (ACC-9): U1's Delete account row and
 * its sheet, and the two pages of the week — "Your account goes on …"
 * and "Keep your account?".
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/account/sign-in"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function deleteRow(
  options: Readonly<{
    hasPassword?: boolean;
    result?: DeletionResult;
    isReturningFromGoogle?: boolean;
  }> = {},
) {
  const request = vi.fn<
    (input: {
      data: { currentPassword?: string | undefined };
    }) => Promise<DeletionResult>
  >(() =>
    Promise.resolve(
      options.result ?? { status: "scheduled", purgeAfter: 1_760_000_000 },
    ),
  );
  const onScheduled = vi.fn(() => Promise.resolve());
  const view = renderWithRouter(
    <DeleteAccount
      hasPassword={options.hasPassword ?? true}
      request={request}
      reauth={<button type="button">Continue with Google</button>}
      isReturningFromGoogle={options.isReturningFromGoogle ?? false}
      onScheduled={onScheduled}
    />,
  );
  return { request, onScheduled, view, user: userEvent.setup() };
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Delete account/u }));
  return screen.getByRole("dialog", { name: "Delete your account?" });
}

describe("DeleteAccount (U1's last row)", () => {
  it("is set apart by a 2px rule, its title in the action colour, and says what happens", async () => {
    const { view } = deleteRow();
    await view;
    const row = document.querySelector("[data-part='delete-account']");
    expect(row).toHaveClass("border-t-2", "border-ink");
    const open = screen.getByRole("button", { name: /^Delete account/u });
    expect(open).toHaveTextContent(
      /^Delete accountDeleted after 7 days\. Log in before then to keep it\.Delete$/u,
    );
    expect(within(open).getByText("Delete account")).toHaveClass("text-action");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks once more, with the date and the current password, Keep it focused", async () => {
    const { view, user } = deleteRow();
    await view;
    const sheet = await openSheet(user);
    expect(
      within(sheet).getByRole("heading", { name: "Delete your account?" }),
    ).toBeInTheDocument();
    const day = proseDayLabel(nowSeconds() + DELETION_GRACE_S);
    expect(sheet).toHaveTextContent(
      `Your runs, closet, entries and photos go in 7 days. Shared runs leave the feed now. Log in before ${day} to keep everything.`,
    );
    expect(within(sheet).getByLabelText("Current password")).toHaveAttribute(
      "type",
      "password",
    );
    await waitFor(() => {
      expect(
        within(sheet).getByRole("button", { name: "Keep it" }),
      ).toHaveFocus();
    });
    await user.click(within(sheet).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses an empty password with the schema's words, sending nothing", async () => {
    const { view, user, request } = deleteRow();
    await view;
    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "Delete my account" }),
    );
    expect(
      await within(sheet).findAllByText("Enter your current password."),
    ).not.toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("sends the password and goes to the date once it is scheduled", async () => {
    const { view, user, request, onScheduled } = deleteRow();
    await view;
    const sheet = await openSheet(user);
    await user.type(within(sheet).getByLabelText("Current password"), "pw-1");
    await user.click(
      within(sheet).getByRole("button", { name: "Delete my account" }),
    );
    await waitFor(() => {
      expect(onScheduled).toHaveBeenCalledWith(1_760_000_000);
    });
    expect(request).toHaveBeenCalledWith({
      data: { currentPassword: "pw-1" },
    });
  });

  it("lands a wrong password on the field", async () => {
    const { view, user, onScheduled } = deleteRow({
      result: { status: "wrong-password" },
    });
    await view;
    const sheet = await openSheet(user);
    await user.type(within(sheet).getByLabelText("Current password"), "nope");
    await user.click(
      within(sheet).getByRole("button", { name: "Delete my account" }),
    );
    expect(
      await within(sheet).findAllByText(CURRENT_PASSWORD_WRONG),
    ).not.toHaveLength(0);
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it("says when the tries are used up, in the runner's own time", async () => {
    const until = 1_760_000_000;
    const { view, user } = deleteRow({
      result: { status: "password-limited", until },
    });
    await view;
    const sheet = await openSheet(user);
    await user.type(within(sheet).getByLabelText("Current password"), "nope");
    await user.click(
      within(sheet).getByRole("button", { name: "Delete my account" }),
    );
    const limited = currentPasswordLimited(clockLabel(until, deviceTimeZone()));
    expect(await within(sheet).findAllByText(limited)).not.toHaveLength(0);
  });

  it("asks an account with no password for nothing, and for Google again when its sign-in is old", async () => {
    const { view, user, request, onScheduled } = deleteRow({
      hasPassword: false,
      result: { status: "reauth" },
    });
    await view;
    const sheet = await openSheet(user);
    expect(within(sheet).queryByLabelText("Current password")).toBeNull();
    expect(
      within(sheet).queryByRole("button", { name: "Continue with Google" }),
    ).toBeNull();
    await user.click(
      within(sheet).getByRole("button", { name: "Delete my account" }),
    );
    const reauth = await within(sheet).findByText(
      "Sign in with Google again to confirm it's you.",
    );
    expect(reauth.closest("[data-state='reauth']")).toContainElement(
      within(sheet).getByRole("button", { name: "Continue with Google" }),
    );
    expect(request).toHaveBeenCalledWith({ data: {} });
    expect(onScheduled).not.toHaveBeenCalled();
  });

  it("opens the sheet again on the way back from Google", async () => {
    const { view } = deleteRow({
      hasPassword: false,
      isReturningFromGoogle: true,
    });
    await view;
    expect(
      screen.getByRole("dialog", { name: "Delete your account?" }),
    ).toBeInTheDocument();
  });
});

function leaving(
  view: Parameters<typeof Leaving>[0]["view"],
  keepResult: KeepResult = "kept",
) {
  const keep = vi.fn(() => Promise.resolve(keepResult));
  const logOut = vi.fn(() => Promise.resolve());
  const onKept = vi.fn(() => Promise.resolve());
  const rendered = renderWithRouter(
    <Leaving view={view} keep={keep} logOut={logOut} onKept={onKept} />,
  );
  return { keep, logOut, onKept, rendered, user: userEvent.setup() };
}

describe("Leaving (round 27 #14)", () => {
  it("tells a runner who just asked when the account goes, signed out", async () => {
    const { rendered } = leaving({ state: "scheduled", day: "Sat, Oct 4" });
    await rendered;
    expect(
      screen.getByRole("heading", { name: "Your account goes on Sat, Oct 4" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Deletion scheduled")).toHaveClass(
      "text-mono-xs",
      "text-cold-text",
    );
    expect(
      screen.getByText(
        "You're signed out on every device. Changed your mind? Log in before then and choose to keep it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    expect(
      screen.getByRole("link", { name: "Open dialed.run" }),
    ).toHaveAttribute("href", "/");
    expect(document.querySelector("[data-part='landing']")).toHaveAttribute(
      "data-state",
      "scheduled",
    );
  });

  it("asks a runner who logged in inside the week, and Keep brings it back", async () => {
    const { rendered, user, keep, onKept, logOut } = leaving({
      state: "ask",
      day: "Sat, Oct 4",
    });
    await rendered;
    expect(
      screen.getByRole("heading", { name: "Keep your account?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "It's set to be deleted on Sat, Oct 4, with everything in it. Keep it and it all comes back as it was.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep my account" }));
    await waitFor(() => {
      expect(onKept).toHaveBeenCalledTimes(1);
    });
    expect(keep).toHaveBeenCalledTimes(1);
    expect(logOut).not.toHaveBeenCalled();
    expect(screen.queryByText(TOO_LATE)).toBeNull();
  });

  it("says so when the purge has already begun, and stays", async () => {
    const { rendered, user, onKept } = leaving(
      { state: "ask", day: "Sat, Oct 4" },
      "too-late",
    );
    await rendered;
    await user.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(await screen.findByText(TOO_LATE)).toHaveAttribute(
      "data-state",
      "too-late",
    );
    expect(TOO_LATE).toBe("Your account is already being deleted.");
    expect(onKept).not.toHaveBeenCalled();
  });

  it("logs out and leaves the date as it was", async () => {
    const { rendered, user, keep, logOut } = leaving({
      state: "ask",
      day: "Sat, Oct 4",
    });
    await rendered;
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await waitFor(() => {
      expect(logOut).toHaveBeenCalledTimes(1);
    });
    expect(keep).not.toHaveBeenCalled();
  });

  it("shows a band when Keep fails, and Try again sends it again", async () => {
    const keep = vi
      .fn<() => Promise<KeepResult>>()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue("kept");
    const onKept = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <Leaving
        view={{ state: "ask", day: "Sat, Oct 4" }}
        keep={keep}
        logOut={() => Promise.resolve()}
        onKept={onKept}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(await screen.findByText("Still scheduled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(onKept).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a band when Log out fails", async () => {
    await renderWithRouter(
      <Leaving
        view={{ state: "ask", day: "Sat, Oct 4" }}
        keep={() => Promise.resolve("kept")}
        logOut={() => Promise.reject(new Error("down"))}
        onKept={() => Promise.resolve()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Still logged in")).toBeInTheDocument();
  });

  it("draws nothing when there is nothing to say", async () => {
    const { rendered } = leaving({ state: "none" });
    await rendered;
    expect(screen.queryByRole("heading")).toBeNull();
    expect(document.querySelector("[data-part='landing']")).toBeNull();
  });
});
