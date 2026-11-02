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
  publicProfile: false,
  publicCloset: false,
  username: "maya_runs",
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
          publicProfile: false,
          publicCloset: false,
          username: undefined,
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
    // PUBLIC, in the screen's word lowercased (round 41 #86a).
    expect(
      privacyRowValue({ defaultAudience: "world", countInTotals: true }),
    ).toBe("New runs public · Counted in totals");
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
        savePublicProfile={vi.fn()}
        pickUsername={vi.fn()}
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
        savePublicProfile={vi.fn()}
        pickUsername={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Privacy" }),
    ).toBeVisible();
    expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
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

  it("hold Privacy's three groups, the switches outside the form and after it (round 38 #61c, round 41 #86b)", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <SettingsSectionPage
        section="sharing"
        current={{ ...ANSWERED, publicProfile: true }}
        isVerified
        saveUnits={vi.fn()}
        saveSharing={vi.fn()}
        saveCountInTotals={vi.fn()}
        savePublicProfile={vi.fn()}
        pickUsername={vi.fn()}
      />,
    );
    const [newRuns, profile, totals] = screen.getAllByRole("heading", {
      level: 2,
    });
    // The legend is the group's kicker (round 42 #92), said once.
    expect(newRuns).toHaveTextContent(/^Who sees new runs$/u);
    expect(screen.getAllByText("Who sees new runs")).toHaveLength(2);
    expect(
      screen.getByRole("group", { name: "Who sees new runs" })
        .firstElementChild,
    ).toHaveClass("sr-only");
    expect(profile).toHaveTextContent(
      /^Public profile · Saves as you switch$/u,
    );
    expect(totals).toHaveTextContent(
      /^Anonymous totals · Saves as you switch$/u,
    );
    // The kicker is mono, in the muted role U1's group headings use.
    expect(newRuns).toHaveClass("text-muted");
    expect(newRuns?.firstElementChild).toHaveClass("text-mono-xs");

    const shared = screen.getByRole("radio", { name: "Shared" });
    const publicly = screen.getByRole("checkbox", { name: "Public profile" });
    const closet = screen.getByRole("checkbox", { name: "Show my closet" });
    const counted = screen.getByRole("checkbox", {
      name: "Count my runs in anonymous totals",
    });
    const save = screen.getByRole("button", { name: "Save" });
    const newRunsGroup = newRuns?.closest("section");
    const profileGroup = profile?.closest("section");
    const totalsGroup = totals?.closest("section");
    expect(newRunsGroup).toContainElement(shared);
    expect(newRunsGroup).toContainElement(save);
    expect(profileGroup).toContainElement(publicly);
    expect(profileGroup).toContainElement(closet);
    expect(totalsGroup).toContainElement(counted);
    // A --hairline-2 rule between each pair of groups.
    const rules = screen.getAllByRole("separator");
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule).toHaveClass(
        "m-0",
        "border-0",
        "border-t",
        "border-hairline-2",
      );
    }
    expect(newRunsGroup?.nextElementSibling).toBe(rules[0]);
    expect(rules[0]?.nextElementSibling).toBe(profileGroup);
    expect(profileGroup?.nextElementSibling).toBe(rules[1]);
    expect(rules[1]?.nextElementSibling).toBe(totalsGroup);
    expect(publicly.closest("form")).toBeNull();
    expect(counted.closest("form")).toBeNull();
    expect(shared.closest("form")).toBe(save.closest("form"));

    shared.focus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(publicly).toHaveFocus();
    await user.tab();
    expect(closet).toHaveFocus();
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
        savePublicProfile={vi.fn()}
        pickUsername={vi.fn()}
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

    const group = screen.getByRole("group", { name: "Who sees new runs" });
    expect(within(group).getByRole("radio", { name: "Shared" })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveSharing).toHaveBeenCalledWith({
      data: { defaultAudience: "private" },
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Privacy saved.");
    });
  });

  it("offer no PUBLIC row while the profile is off, and say where it comes from (round 41 #86b)", async () => {
    await renderWithRouter(
      <SharingForm current={ANSWERED} saveSharing={vi.fn()} />,
    );
    const group = screen.getByRole("group", { name: "Who sees new runs" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toStrictEqual(["private", "runners"]);
    const line = screen.getByText(
      "Public is a choice here once your profile is public. You can still make any one run public.",
    );
    expect(line).toHaveClass("m-0", "text-small", "text-muted");
    // In the third row's place: after the rows, before Save.
    expect(group.nextElementSibling).toBe(line);
  });

  it("offer PUBLIC as a default while the profile is public, with no line", async () => {
    const user = userEvent.setup();
    const saveSharing = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      <SharingForm
        current={{ defaultAudience: "world", publicProfile: true }}
        saveSharing={saveSharing}
      />,
    );
    const group = screen.getByRole("group", { name: "Who sees new runs" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toStrictEqual(["private", "runners", "world"]);
    expect(within(group).getByRole("radio", { name: "Public" })).toBeChecked();
    expect(screen.queryByText(/^Public is a choice here/u)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveSharing).toHaveBeenCalledWith({
      data: { defaultAudience: "world" },
    });
  });

  it("mark the default's field with the server's refusal", async () => {
    // A stale page can send PUBLIC after the profile went off elsewhere.
    const user = userEvent.setup();
    const saveSharing = vi.fn().mockRejectedValue({
      issues: [
        {
          path: ["defaultAudience"],
          message: "Public is a choice here once your profile is public.",
        },
      ],
    });
    await renderWithRouter(
      <SharingForm
        current={{ defaultAudience: "world", publicProfile: true }}
        saveSharing={saveSharing}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(
        "Public is a choice here once your profile is public.",
      ),
    ).toHaveAttribute("id", "defaultAudience-message");
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
