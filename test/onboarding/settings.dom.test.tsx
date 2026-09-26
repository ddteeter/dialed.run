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
  SettingsIndex,
  SharingForm,
  UnitsForm,
} from "../../src/modules/onboarding/components/Settings";
import {
  SettingsBack,
  SettingsSectionPage,
  SettingsSubPage,
} from "../../src/modules/onboarding/components/SettingsSubPage";
import type { CurrentSettings } from "../../src/modules/onboarding/profile";

/**
 * Settings as round 22 rules it (item 20): U1/N's tap-through index, one
 * small form per sub-page.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/onboarding/settings"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const ANSWERED: CurrentSettings = {
  thermalLevel: 0,
  tempUnit: "f",
  distanceUnit: "mi",
  shareDefault: true,
};

function row(name: RegExp) {
  return screen.getByRole("link", { name });
}

describe("the index (U1/N)", () => {
  it("says every row's current value, and each opens somewhere", async () => {
    await renderWithRouter(
      <SettingsIndex current={ANSWERED} blockedCount={2} signOut={undefined} />,
    );

    expect(row(/^How you run/u)).toHaveAttribute(
      "href",
      "/onboarding/calibrate",
    );
    expect(row(/^How you run/u)).toHaveTextContent(
      "Currently About average, 0° offset",
    );
    expect(row(/^Units/u)).toHaveAttribute(
      "href",
      "/onboarding/settings/units",
    );
    expect(row(/^Units/u)).toHaveTextContent("Fahrenheit, miles");
    expect(row(/^Privacy/u)).toHaveAttribute(
      "href",
      "/onboarding/settings/sharing",
    );
    expect(row(/^Privacy/u)).toHaveTextContent("New runs go to the feed");
    expect(row(/^Blocked runners/u)).toHaveAttribute("href", "/safety/blocked");
    expect(row(/^Blocked runners/u)).toHaveTextContent("2 blocked");
    expect(row(/^Connections/u)).toHaveAttribute("href", "/runs/strava");
    // A row with nowhere to go is absent, not dead.
    expect(
      screen.queryByText(/Export|Delete|Notifications|Account/u),
    ).toBeNull();
  });

  it("groups the rows under U1's headings, in U1's order", async () => {
    await renderWithRouter(
      <SettingsIndex current={ANSWERED} blockedCount={0} signOut={undefined} />,
    );
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["You", "Who sees what", "Review", "Data"]);
    const you = screen.getByRole("heading", { name: "You" }).closest("section");
    expect(
      within(you ?? document.body)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/onboarding/calibrate", "/onboarding/settings/units"]);
  });

  it("says the other value of each row the other way round", async () => {
    await renderWithRouter(
      <SettingsIndex
        current={{
          thermalLevel: -2,
          tempUnit: "c",
          distanceUnit: "km",
          shareDefault: false,
        }}
        blockedCount={0}
        signOut={undefined}
      />,
    );
    expect(row(/^Units/u)).toHaveTextContent("Celsius, kilometres");
    expect(row(/^Privacy/u)).toHaveTextContent("New runs stay private");
    expect(row(/^How you run/u)).toHaveTextContent("−4° offset");
    expect(row(/^Blocked runners/u)).toHaveTextContent("0 blocked");
  });

  it("asks the unanswered calibration as the ruling words it", async () => {
    // "'How you run' · 'Not answered' in --muted · 'Answer ›'."
    await renderWithRouter(
      <SettingsIndex
        current={{ ...ANSWERED, thermalLevel: undefined }}
        blockedCount={0}
        signOut={undefined}
      />,
    );
    const calibration = row(/^How you run/u);
    expect(calibration).toHaveTextContent(/^How you runNot answeredAnswer ›$/u);
    expect(within(calibration).getByText("Not answered")).toHaveClass(
      "text-muted",
    );
    expect(row(/^Units/u)).toHaveTextContent(/›$/u);
    expect(row(/^Units/u)).not.toHaveTextContent("Answer");
  });

  it("puts the caller's sign-out at the foot", async () => {
    await renderWithRouter(
      <SettingsIndex
        current={ANSWERED}
        blockedCount={0}
        signOut={<button type="button">Sign out</button>}
      />,
    );
    const links = screen.getAllByRole("link");
    const signOut = screen.getByRole("button", { name: "Sign out" });
    expect(links.at(-1)?.compareDocumentPosition(signOut)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe("the sub-pages", () => {
  it("go back to the index", async () => {
    await renderWithRouter(<SettingsBack />);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/onboarding/settings",
    );
  });

  it("wraps a sub-page in its shell: the title, the way back, and its own content", async () => {
    await renderWithRouter(
      <SettingsSubPage title="Units">
        <p>Its own form</p>
      </SettingsSubPage>,
    );
    expect(screen.getByRole("heading", { name: "Units" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/onboarding/settings",
    );
    expect(screen.getByText("Its own form")).toBeVisible();
  });

  it("are Units and Privacy by their section, each with its own form", async () => {
    const saveUnits = vi.fn().mockResolvedValue(undefined);
    const saveSharing = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await renderWithRouter(
      <SettingsSectionPage
        section="units"
        current={ANSWERED}
        saveUnits={saveUnits}
        saveSharing={saveSharing}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Units" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: "°F" })).toBeChecked();
    expect(screen.queryByRole("checkbox")).toBeNull();
    unmount();

    await renderWithRouter(
      <SettingsSectionPage
        section="sharing"
        current={ANSWERED}
        saveUnits={saveUnits}
        saveSharing={saveSharing}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Share to feed by default" }),
    ).toBeChecked();
    expect(screen.queryByRole("radio")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(saveSharing).toHaveBeenCalledWith({ data: { shareDefault: true } });
    expect(saveUnits).not.toHaveBeenCalled();
  });

  it("save units, and only units, from their own form", async () => {
    const user = userEvent.setup();
    const saveUnits = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      <UnitsForm current={ANSWERED} saveUnits={saveUnits} />,
    );

    expect(screen.getByRole("radio", { name: "°F" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "mi" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "°C" }));
    await user.click(screen.getByRole("radio", { name: "km" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveUnits).toHaveBeenCalledWith({
      data: { tempUnit: "c", distanceUnit: "km" },
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Units saved.");
    });
  });

  it("say Nothing saved when the units save fails", async () => {
    const user = userEvent.setup();
    const saveUnits = vi.fn().mockRejectedValue(new Error("D1 down"));
    await renderWithRouter(
      <UnitsForm current={ANSWERED} saveUnits={saveUnits} />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing saved")).toBeVisible();
  });

  it("save the sharing default, and only that, from its own form", async () => {
    const user = userEvent.setup();
    const saveSharing = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      <SharingForm current={ANSWERED} saveSharing={saveSharing} />,
    );

    const toggle = screen.getByRole("checkbox", {
      name: "Share to feed by default",
    });
    expect(toggle).toBeChecked();
    expect(screen.getByText("You can flip it per run.")).toBeVisible();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveSharing).toHaveBeenCalledWith({ data: { shareDefault: false } });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Privacy saved.");
    });
  });

  it("never let the browser submit either form", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <SharingForm
        current={ANSWERED}
        saveSharing={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const form = screen.getByRole("button", { name: "Save" }).closest("form");
    expect(form).toHaveAttribute("novalidate");
    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Save" }));
    } finally {
      document.removeEventListener("submit", watch);
    }
    expect(prevented).toBe(true);
  });
});
