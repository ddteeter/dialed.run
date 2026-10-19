import { Link } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { Icon, Mono, Page } from "../../../ui";
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
 * One of a sub-page's groups: a mono kicker over what it holds, as U1's
 * groups are headed. `ruled` draws the `--hairline-2` rule above it that
 * parts it from the group before.
 */
function SubPageGroup({
  title,
  ruled = false,
  children,
}: Readonly<{
  title: string;
  ruled?: boolean;
  children: ReactNode;
}>): JSX.Element {
  return (
    <section
      className={
        ruled
          ? "flex flex-col gap-3 border-t border-hairline-2 pt-4"
          : "flex flex-col gap-3"
      }
    >
      <h2 className="m-0 text-muted">
        <Mono step="xs">{title}</Mono>
      </h2>
      {children}
    </section>
  );
}

type SectionPageProps = Readonly<{
  section: SettingsSection;
  current: CurrentSettings;
  /**
  Whether the runner's address is confirmed: the totals switch's lines.
  */
  isVerified: boolean;
  saveUnits: Parameters<typeof UnitsForm>[0]["saveUnits"];
  saveSharing: Parameters<typeof SharingForm>[0]["saveSharing"];
  saveCountInTotals: Parameters<typeof TotalsSwitch>[0]["save"];
}>;

/**
 * One sub-page: its title, the way back, and its own small form.
 *
 * **Privacy holds two controls that save differently** (round 38 #61c):
 * NEW RUNS is a form with its Save, and ANONYMOUS TOTALS saves on toggle,
 * so it sits after the form's end, outside it, under a rule and a kicker
 * that says so. A failure there is §4a's NOT CHANGED in its own group.
 * The totals switch comes last, so Tab never passes it between the form's
 * field and its Save.
 */
export function SettingsSectionPage(props: SectionPageProps): JSX.Element {
  const {
    section,
    current,
    isVerified,
    saveUnits,
    saveSharing,
    saveCountInTotals,
  } = props;
  return (
    <PickedSubPage
      section={section}
      titles={SECTION_TITLES}
      pages={{
        units: <UnitsForm current={current} saveUnits={saveUnits} />,
        sharing: (
          <>
            <SubPageGroup title="New runs">
              <SharingForm current={current} saveSharing={saveSharing} />
            </SubPageGroup>
            <SubPageGroup title="Anonymous totals · Saves as you switch" ruled>
              <TotalsSwitch
                initial={current.countInTotals}
                isVerified={isVerified}
                save={saveCountInTotals}
              />
            </SubPageGroup>
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
