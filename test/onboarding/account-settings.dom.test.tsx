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
  AccountIndex,
  NotificationSettings,
} from "../../src/modules/onboarding/components/Settings";
import { PickedSubPage } from "../../src/modules/onboarding/components/SettingsSubPage";

/**
 * Settings › Account (ACC-7, ACC-8) and Settings › Notifications (ACC-11;
 * round 26 #19).
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

describe("AccountIndex (U1 Account)", () => {
  it("shows the address, the handle and the password, each opening its page", async () => {
    await renderWithRouter(
      <AccountIndex
        account={{
          email: "maya@example.com",
          isVerified: true,
          hasPassword: true,
        }}
        username="maya_runs"
        confirmBand={<p>the band</p>}
        signOutEverywhere={<button type="button">everywhere</button>}
        dataExport={
          <li>
            <button type="button">export</button>
          </li>
        }
        deletion={<button type="button">delete</button>}
      />,
    );
    const email = screen.getByRole("link", { name: /^Email/u });
    expect(email).toHaveAttribute("href", "/account/email");
    expect(email).toHaveTextContent(/^Emailmaya@example\.comChange$/u);
    expect(email).toHaveAccessibleName(/Change$/u);
    expect(screen.getByRole("link", { name: /^Username/u })).toHaveAttribute(
      "href",
      "/account/username",
    );
    expect(screen.getByRole("link", { name: /^Username/u })).toHaveTextContent(
      /^Username@maya_runsChange$/u,
    );
    const password = screen.getByRole("link", { name: /^Password/u });
    expect(password).toHaveAttribute("href", "/account/password");
    expect(password).toHaveTextContent(
      /^PasswordChange the password you log in withChange$/u,
    );
    // R55·182.1: every Account row ends in one bold --cold-text verb, and
    // no chevron.
    for (const link of [email, password]) {
      expect(link.querySelector("svg")).toBeNull();
      const verb = within(link).getByText("Change");
      expect(verb).toHaveClass("font-bold", "text-cold-text");
      expect(link.lastElementChild).toBe(verb);
    }
    // The nag sits first, then the rows, then signing out everywhere, the
    // export and — last, round 27 #14 — deleting the account.
    const order = Array.from(
      document.querySelectorAll("p, a, button"),
      (node) => node.textContent,
    );
    expect(order[0]).toBe("the band");
    expect(order.slice(-3)).toStrictEqual(["everywhere", "export", "delete"]);
    // R55·182.2: signing out everywhere is SIGN-IN's last row.
    const signIn = screen
      .getByRole("heading", { name: "Sign-in" })
      .closest("section");
    const rows = signIn?.querySelectorAll("li");
    expect(rows).toHaveLength(4);
    expect(rows?.[3]).toHaveTextContent(/^everywhere$/u);
  });

  it("puts the export row under Your data (ACC-10)", async () => {
    await renderWithRouter(
      <AccountIndex
        account={{
          email: "maya@example.com",
          isVerified: true,
          hasPassword: true,
        }}
        username="maya_runs"
        confirmBand={undefined}
        signOutEverywhere={undefined}
        dataExport={
          <li>
            <button type="button">export</button>
          </li>
        }
        deletion={undefined}
      />,
    );
    const exporting = screen.getByRole("button", { name: "export" });
    expect(
      screen.getByRole("heading", { name: "Your data" }).closest("section"),
    ).toContainElement(exporting);
  });

  it("says an unconfirmed address is not confirmed yet, and a Google account has no password row", async () => {
    await renderWithRouter(
      <AccountIndex
        account={{
          email: "maya@example.com",
          isVerified: false,
          hasPassword: false,
        }}
        username={undefined}
        confirmBand={undefined}
        signOutEverywhere={undefined}
        dataExport={undefined}
        deletion={undefined}
      />,
    );
    expect(screen.getByRole("link", { name: /^Email/u })).toHaveTextContent(
      "maya@example.com · not confirmed yet",
    );
    expect(screen.getByRole("link", { name: /^Username/u })).toHaveTextContent(
      "Not picked",
    );
    expect(screen.queryByRole("link", { name: /^Password/u })).toBeNull();
  });
});

function renderForm(
  isOn = true,
  save = vi.fn<(input: { data: { runReminder: boolean } }) => Promise<unknown>>(
    () => Promise.resolve(),
  ),
) {
  const user = userEvent.setup();
  const view = renderWithRouter(
    <NotificationSettings
      current={{ email: "maya@example.com", runReminder: isOn }}
      save={save}
      changeEmail={<span>Change email</span>}
    />,
  );
  return { save, user, view };
}

describe("NotificationSettings", () => {
  it("has the reminder's email switch, Useful in the app only, account email always sent — and no push", async () => {
    const { view } = renderForm();
    await view;
    for (const [title, when] of [
      [
        "Run reminders",
        "When a run lands on Strava. Only while Strava is connected.",
      ],
      ["Useful on your runs", "When a runner finds your run useful."],
      [
        "Account and security",
        "Confirming your email, password and email changes.",
      ],
    ] as const) {
      const heading = screen.getByRole("heading", { name: title });
      const section = heading.closest("section");
      expect(section).toHaveTextContent(when);
    }
    const reminder = screen
      .getByRole("heading", { name: "Run reminders" })
      .closest("section");
    expect(
      within(reminder ?? document.body).getByRole("switch", {
        name: "Email",
      }),
    ).toBeChecked();
    const useful = screen
      .getByRole("heading", { name: "Useful on your runs" })
      .closest("section");
    expect(
      within(useful ?? document.body).getByText("In the app only"),
    ).toBeVisible();
    const account = screen
      .getByRole("heading", { name: "Account and security" })
      .closest("section");
    expect(
      within(account ?? document.body).getByText("Always sent"),
    ).toBeVisible();
    // One switch, at its row's right, named by its 600 label, and
    // described by when the reminder comes (D-185, R54·166.3/166.5).
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.queryByRole("checkbox")).toBeNull();
    const email = screen.getByRole("switch", { name: "Email" });
    expect(email).toHaveAccessibleDescription(
      "When a run lands on Strava. Only while Strava is connected.",
    );
    expect(email.closest("label")).toHaveClass(
      "justify-between",
      "font-semibold",
    );
    expect(email.closest("label")?.lastElementChild).toBe(email);
    // It saves as it changes, so there is nothing to submit.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByText(/push/iu)).toBeNull();
    expect(screen.getByText(/^Emails go to/u)).toHaveTextContent(
      "Emails go to maya@example.com. Change email",
    );
  });

  it("saves as it switches, and says Saved. in the page's one status region", async () => {
    const { save, user, view } = renderForm(true);
    await view;
    const email = screen.getByRole("switch", { name: "Email" });
    // Nothing is said before anything is saved.
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.click(email);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      data: { runReminder: false },
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/^Saved\.$/u);
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(email).not.toBeChecked();

    // Again: the status clears as the next save starts, so it is heard.
    await user.click(email);
    expect(save).toHaveBeenLastCalledWith({ data: { runReminder: true } });
    await waitFor(() => {
      expect(email).toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/^Saved\.$/u);
  });

  it("keeps the switch as it was under Not changed when the save fails, and Try again saves it", async () => {
    const save = vi
      .fn<(input: { data: { runReminder: boolean } }) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValueOnce(undefined);
    const { user, view } = renderForm(true, save);
    await view;
    const email = screen.getByRole("switch", { name: "Email" });
    await user.click(email);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Not changed. Our end failed.",
      );
    });
    expect(email).toBeChecked();
    expect(screen.getByText("Not changed")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(save).toHaveBeenLastCalledWith({ data: { runReminder: false } });
    await waitFor(() => {
      expect(email).not.toBeChecked();
    });
    expect(screen.getByRole("status")).toHaveTextContent(/^Saved\.$/u);
    expect(screen.queryByText("Not changed")).toBeNull();
  });

  it("starts from what is saved", async () => {
    const { view } = renderForm(false);
    await view;
    expect(screen.getByRole("switch", { name: "Email" })).not.toBeChecked();
  });
});

function picked(section: "a" | "b"): ReactElement {
  return (
    <PickedSubPage
      section={section}
      titles={{ a: "First", b: "Second" }}
      pages={{ a: <p>page a</p>, b: <p>page b</p> }}
    />
  );
}

describe("PickedSubPage", () => {
  it("shows the section asked for, under its title and the way back", async () => {
    await renderWithRouter(picked("b"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Second" }),
    ).toBeVisible();
    expect(screen.getByText("page b")).toBeVisible();
    expect(screen.queryByText("page a")).toBeNull();
    expect(screen.getByRole("link", { name: /Settings/u })).toHaveAttribute(
      "href",
      "/onboarding/settings",
    );
  });
});
