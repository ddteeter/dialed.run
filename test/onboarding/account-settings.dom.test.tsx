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
  NotificationsForm,
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
      />,
    );
    const email = screen.getByRole("link", { name: /^Email/u });
    expect(email).toHaveAttribute("href", "/account/email");
    expect(email).toHaveTextContent(/^Emailmaya@example\.comChange ›$/u);
    expect(screen.getByRole("link", { name: /^Username/u })).toHaveAttribute(
      "href",
      "/account/username",
    );
    expect(screen.getByRole("link", { name: /^Username/u })).toHaveTextContent(
      "@maya_runs",
    );
    const password = screen.getByRole("link", { name: /^Password/u });
    expect(password).toHaveAttribute("href", "/account/password");
    expect(password).toHaveTextContent("Change the password you log in with");
    // The nag sits first, then the rows, then signing out everywhere.
    const order = Array.from(
      document.querySelectorAll("p, a, button"),
      (node) => node.textContent,
    );
    expect(order[0]).toBe("the band");
    expect(order.at(-1)).toBe("everywhere");
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

function renderForm(isOn = true) {
  const save = vi.fn(() => Promise.resolve());
  const user = userEvent.setup();
  const view = renderWithRouter(
    <NotificationsForm
      current={{ email: "maya@example.com", runReminder: isOn }}
      save={save}
      changeEmail={<span>Change email</span>}
    />,
  );
  return { save, user, view };
}

describe("NotificationsForm", () => {
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
      within(reminder ?? document.body).getByRole("checkbox", {
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
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.queryByText(/push/iu)).toBeNull();
    expect(screen.getByText(/^Emails go to/u)).toHaveTextContent(
      "Emails go to maya@example.com. Change email",
    );
  });

  it("saves the switch", async () => {
    const { save, user, view } = renderForm(true);
    await view;
    await user.click(screen.getByRole("checkbox", { name: "Email" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith({ data: { runReminder: false } });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Notifications saved.",
      );
    });
  });

  it("starts from what is saved", async () => {
    const { view } = renderForm(false);
    await view;
    expect(screen.getByRole("checkbox", { name: "Email" })).not.toBeChecked();
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
