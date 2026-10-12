import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { Icon, Page } from "../../../ui";
import type { CurrentSettings } from "../profile";
import type { SettingsSection } from "../route-decisions";
import { SharingForm, UnitsForm } from "./Settings";
import { TotalsSwitch } from "./TotalsSwitch";

/*
 * Its own file, apart from `Settings.tsx`, because the index route renders
 * `SettingsIndex` under its own `Page title` — and a screen has one h1
 * (Accessibility Contract rule 04). The sub-page frame's titled `Page`
 * sitting in the index's component file read as a second heading on that
 * screen to `one-h1-per-route`, which follows imports file by file.
 */

/**
 * Where a sub-page's back link goes, and what it says. Settings, almost
 * always; the terms prompt from the account page a runner behind on the
 * terms reads, because there "the back link returns to the gate" (round 30
 * #4a, "‹ Terms").
 */
const BACKS = {
  settings: { to: "/onboarding/settings", label: "Settings" },
  terms: { to: "/account/terms", label: "Terms" },
} as const;

type Back = keyof typeof BACKS;

/**
 * The sub-pages' way back to the index: *"sub-pages keep [the tab bar],
 * with back"*.
 */
export function SettingsBack({
  to = "settings",
}: Readonly<{ to?: Back | undefined }>): JSX.Element {
  const back = BACKS[to];
  return (
    <Link
      to={back.to}
      className="target inline-flex items-center gap-2 self-start text-ink no-underline"
    >
      <Icon name="back" size={20} />
      <span className="text-body">{back.label}</span>
    </Link>
  );
}

/**
 * The frame every settings sub-page route wraps its one form in: the page
 * shell and the way back — round 22, item 20's "sub-pages keep [the tab
 * bar], with back."
 *
 * **Not the bell.** `BelledLayout` lives in `modules/notifications`, and a
 * module may only reach another module through its `index.ts`
 * (`no-cross-module-deep-imports`) — `BelledLayout` isn't part of that
 * barrel, only its route-file glue is. So each sub-page route still wraps
 * its own `<BelledLayout unreadCount={...}>` around this, the way
 * `modules/onboarding/functions.ts`'s `settingsSubPageData` keeps the
 * loader side of the same boundary.
 */
export function SettingsSubPage({
  title,
  back,
  children,
}: Readonly<{
  title: string;
  back?: Back | undefined;
  children: ReactNode;
}>): JSX.Element {
  return (
    <Page title={title} width="column">
      <SettingsBack to={back} />
      {children}
    </Page>
  );
}

const SECTION_TITLES: Readonly<Record<SettingsSection, string>> = {
  units: "Units",
  sharing: "Privacy",
};

/**
 * One sub-page: its title, the way back, and its own small form. Privacy
 * also holds D-108's totals switch, which saves on toggle rather than
 * with the form's Save (round 32: "one SHARING group beside 'Share new
 * runs'").
 */
export function SettingsSectionPage({
  section,
  current,
  saveUnits,
  saveSharing,
  saveCountInTotals,
}: Readonly<{
  section: SettingsSection;
  current: CurrentSettings;
  saveUnits: Parameters<typeof UnitsForm>[0]["saveUnits"];
  saveSharing: Parameters<typeof SharingForm>[0]["saveSharing"];
  saveCountInTotals: Parameters<typeof TotalsSwitch>[0]["save"];
}>): JSX.Element {
  return (
    <PickedSubPage
      section={section}
      titles={SECTION_TITLES}
      pages={{
        units: <UnitsForm current={current} saveUnits={saveUnits} />,
        sharing: (
          <>
            <SharingForm current={current} saveSharing={saveSharing} />
            <TotalsSwitch
              initial={current.countInTotals}
              save={saveCountInTotals}
            />
          </>
        ),
      }}
    />
  );
}

/**
 * One page of a sectioned settings route — the account's (ACC-7, ACC-8,
 * ACC-11) — picked by its section: the section's title over its form.
 * The route builds every section's form and this shows the one asked for,
 * so the route holds no choice of its own.
 */
export function PickedSubPage<TSection extends string>({
  section,
  titles,
  pages,
  back,
}: Readonly<{
  section: TSection;
  titles: Readonly<Record<TSection, string>>;
  pages: Readonly<Record<TSection, ReactNode>>;
  back?: Back | undefined;
}>): JSX.Element {
  return (
    <SettingsSubPage title={titles[section]} back={back}>
      {pages[section]}
    </SettingsSubPage>
  );
}
