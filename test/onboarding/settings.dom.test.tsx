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
  privacyRowValue,
  SharingForm,
  UnitsForm,
} from "../../src/modules/onboarding/components/Settings";
import {
  PickedSubPage,
  SettingsBack,
  SettingsSectionPage,
  SettingsSubPage,
} from "../../src/modules/onboarding/components/SettingsSubPage";
import type { CurrentSettings } from "../../src/modules/onboarding/profile";
import { carriedSince } from "../ui/carry-spy";

vi.mock("../../src/ui/use-form-submit", async (importOriginal) => {
  const { spyOnCarry } = await import("../ui/carry-spy");
  return spyOnCarry(await importOriginal());
});

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
  defaultAudience: "runners",
  countInTotals: true,
};

function row(name: RegExp) {
  return screen.getByRole("link", { name });
}

describe("the index (U1/N)", () => {
  it("says every row's current value, and each opens somewhere", async () => {
    await renderWithRouter(
      <SettingsIndex
        current={ANSWERED}
        username="maya_runs"
        runReminderEmail
        blockedCount={2}
        signOut={undefined}
      />,
    );

    // U1's Account row (ACC-7/8): the handle, "@" included as everywhere,
    // and what else lives behind it.
    expect(row(/^Account/u)).toHaveAttribute("href", "/account/sign-in");
    expect(row(/^Account/u)).toHaveTextContent(
      /^Account@maya_runs · email, password›$/u,
    );
    // ACC-11: the one email a runner can switch.
    expect(row(/^Notifications/u)).toHaveAttribute(
      "href",
      "/account/notifications",
    );
    expect(row(/^Notifications/u)).toHaveTextContent("Run reminders by email");
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
    expect(row(/^Privacy New/u)).toHaveAttribute(
      "href",
      "/onboarding/settings/sharing",
    );
    expect(row(/^Privacy New/u)).toHaveTextContent(
      /^PrivacyNew runs shared · Counted in totals›$/u,
    );
    // Settings › About (ACC-13, D-52; round 28 #7): the legal texts.
    expect(row(/^Privacy policy/u)).toHaveAttribute("href", "/privacy");
    expect(row(/^Privacy policy/u)).toHaveTextContent(
      /^Privacy policyWhat we keep, and who sees it›$/u,
    );
    expect(row(/^Terms/u)).toHaveAttribute("href", "/terms");
    expect(row(/^Terms/u)).toHaveTextContent(
      /^TermsThe rules for using dialed\.run›$/u,
    );
    expect(row(/^Copyright/u)).toHaveAttribute("href", "/copyright");
    expect(row(/^Copyright/u)).toHaveTextContent(
      /^CopyrightReport something of yours posted here›$/u,
    );
    // Round 29 #9 (plan C9): after Copyright.
    expect(row(/^Open source/u)).toHaveAttribute("href", "/open-source");
    expect(row(/^Open source/u)).toHaveTextContent(
      /^Open sourceWhat dialed\.run is built on›$/u,
    );
    expect(row(/^Blocked runners/u)).toHaveAttribute("href", "/safety/blocked");
    expect(row(/^Blocked runners/u)).toHaveTextContent("2 blocked");
    expect(row(/^Connections/u)).toHaveAttribute("href", "/runs/strava");
    // A row with nowhere to go is absent, not dead.
    expect(screen.queryByText(/Export|Delete/u)).toBeNull();
  });

  it("groups the rows under U1's headings, in U1's order", async () => {
    await renderWithRouter(
      <SettingsIndex
        current={ANSWERED}
        username="maya_runs"
        runReminderEmail
        blockedCount={0}
        signOut={undefined}
      />,
    );
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["You", "Who sees what", "Review", "Data", "About"]);
    const you = screen.getByRole("heading", { name: "You" }).closest("section");
    expect(
      within(you ?? document.body)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/account/sign-in",
      "/onboarding/calibrate",
      "/onboarding/settings/units",
    ]);
  });

  it("says the other value of each row the other way round", async () => {
    await renderWithRouter(
      <SettingsIndex
        username={undefined}
        current={{
          thermalLevel: -2,
          tempUnit: "c",
          distanceUnit: "km",
          defaultAudience: "private",
          countInTotals: false,
        }}
        runReminderEmail={false}
        blockedCount={0}
        signOut={undefined}
      />,
    );
    expect(row(/^Units/u)).toHaveTextContent("Celsius, kilometres");
    expect(row(/^Notifications/u)).toHaveTextContent(
      "Run reminders in the app only",
    );
    expect(row(/^Privacy New/u)).toHaveTextContent(
      /^PrivacyNew runs private · Not counted›$/u,
    );
    expect(row(/^How you run/u)).toHaveTextContent("−4° offset");
    expect(row(/^Blocked runners/u)).toHaveTextContent("0 blocked");
    // An account that has not reached O0 has no handle to show.
    expect(row(/^Account/u)).toHaveTextContent(/^AccountEmail, password›$/u);
  });

  it("states both Privacy settings on its row, each its own way (round 38 #61b)", () => {
    expect(
      privacyRowValue({ defaultAudience: "runners", countInTotals: false }),
    ).toBe("New runs shared · Not counted");
    expect(
      privacyRowValue({ defaultAudience: "private", countInTotals: true }),
    ).toBe("New runs private · Counted in totals");
  });

  it("asks the unanswered calibration as the ruling words it", async () => {
    // "'How you run' · 'Not answered' in --muted · 'Answer ›'."
    await renderWithRouter(
      <SettingsIndex
        current={{ ...ANSWERED, thermalLevel: undefined }}
        username="maya_runs"
        runReminderEmail
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
        username="maya_runs"
        runReminderEmail
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

  it("goes back to the terms prompt from the page a runner behind on the terms reads (round 30 #4a)", async () => {
    await renderWithRouter(<SettingsBack to="terms" />);
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/account/terms",
    );
  });

  it("picks the sub-page's way back", async () => {
    await renderWithRouter(
      <PickedSubPage
        section="sign-in"
        titles={{ "sign-in": "Account" }}
        pages={{ "sign-in": <p>Read only</p> }}
        back="terms"
      />,
    );
    expect(screen.getByRole("heading", { name: "Account" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/account/terms",
    );
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
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
    const saveCountInTotals = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await renderWithRouter(
      <SettingsSectionPage
        section="units"
        current={ANSWERED}
        isVerified
        saveUnits={saveUnits}
        saveSharing={saveSharing}
        saveCountInTotals={saveCountInTotals}
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
        isVerified
        saveUnits={saveUnits}
        saveSharing={saveSharing}
        saveCountInTotals={saveCountInTotals}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy" }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Share new runs" }),
    ).toBeChecked();
    expect(screen.queryByRole("radio")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Save" }));
    expect(saveSharing).toHaveBeenCalledWith({
      data: { defaultAudience: "runners" },
    });
    expect(saveUnits).not.toHaveBeenCalled();
    // D-108's switch sits beside the default and saves on its own.
    expect(
      screen.getByRole("checkbox", {
        name: "Count my runs in anonymous totals",
      }),
    ).toBeChecked();
    expect(saveCountInTotals).not.toHaveBeenCalled();
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

  it("hold Privacy's two controls in two groups, the totals switch outside the form and last (round 38 #61c)", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <SettingsSectionPage
        section="sharing"
        current={ANSWERED}
        isVerified
        saveUnits={vi.fn()}
        saveSharing={vi.fn()}
        saveCountInTotals={vi.fn()}
      />,
    );
    const [newRuns, totals] = screen.getAllByRole("heading", { level: 2 });
    expect(newRuns).toHaveTextContent(/^New runs$/u);
    expect(totals).toHaveTextContent(
      /^Anonymous totals · Saves as you switch$/u,
    );
    // The kicker is mono, in the muted role U1's group headings use.
    expect(newRuns).toHaveClass("text-muted");
    expect(newRuns?.firstElementChild).toHaveClass("text-mono-xs");

    const share = screen.getByRole("checkbox", { name: "Share new runs" });
    const counted = screen.getByRole("checkbox", {
      name: "Count my runs in anonymous totals",
    });
    const save = screen.getByRole("button", { name: "Save" });
    const newRunsGroup = newRuns?.closest("section");
    const totalsGroup = totals?.closest("section");
    expect(newRunsGroup).toContainElement(share);
    expect(newRunsGroup).toContainElement(save);
    expect(totalsGroup).toContainElement(counted);
    // One --hairline-2 rule, between the two groups.
    const rule = screen.getByRole("separator");
    expect(rule).toHaveClass("border-t", "border-hairline-2");
    expect(newRunsGroup?.nextElementSibling).toBe(rule);
    expect(rule.nextElementSibling).toBe(totalsGroup);
    expect(counted.closest("form")).toBeNull();
    expect(share.closest("form")).toBe(save.closest("form"));

    share.focus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(counted).toHaveFocus();
  });

  it("give the totals switch an unconfirmed runner's lines on Privacy (round 38 #61d)", async () => {
    await renderWithRouter(
      <SettingsSectionPage
        section="sharing"
        current={ANSWERED}
        isVerified={false}
        saveUnits={vi.fn()}
        saveSharing={vi.fn()}
        saveCountInTotals={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Count my runs in anonymous totals",
      }),
    ).toHaveAccessibleDescription(/^Once you confirm your email/u);
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
      name: "Share new runs",
    });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(
        "Runners on dialed.run see their kit, conditions and verdict. You can change any run.",
      ),
    ).toBeVisible();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveSharing).toHaveBeenCalledWith({
      data: { defaultAudience: "private" },
    });
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

describe("Settings' sub-page forms: a lapsed session (Au7, D-151)", () => {
  it("carries settings to log-in", async () => {
    carriedSince();
    await renderWithRouter(
      <UnitsForm current={ANSWERED} saveUnits={vi.fn()} />,
    );

    expect(carriedSince()).toEqual(["settings"]);
  });
});
