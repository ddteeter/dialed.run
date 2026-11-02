import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { JSX, ReactNode } from "react";

import { Icon, Page } from "../../../ui";
import type { CurrentSettings } from "../profile";
import type { SettingsSection } from "../route-decisions";
import type { PublicProfileState } from "../public-profile";
import { NoHandleYet, type PickUsernameForm } from "./PickUsername";
import {
  DEFAULT_MOVED_LINE,
  PublicProfileSwitches,
} from "./PublicProfileSwitches";
import {
  GroupSection,
  SHARE_DEFAULT_LEGEND,
  SharingForm,
  UnitsForm,
} from "./Settings";
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
 * groups are headed.
 */
function SubPageGroup({
  title,
  children,
}: Readonly<{
  title: string;
  children: ReactNode;
}>): JSX.Element {
  return (
    <GroupSection title={title} className="flex flex-col gap-3">
      {children}
    </GroupSection>
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
  savePublicProfile: Parameters<typeof PublicProfileSwitches>[0]["save"];
  /**
  The username form Privacy's sheet holds for a runner with no handle yet.
  */
  pickUsername: PickUsernameForm;
}>;

/**
 * One sub-page: its title, the way back, and its own small form.
 */
export function SettingsSectionPage(props: SectionPageProps): JSX.Element {
  const { section, current, saveUnits } = props;
  return (
    <PickedSubPage
      section={section}
      titles={SECTION_TITLES}
      pages={{
        units: <UnitsForm current={current} saveUnits={saveUnits} />,
        sharing: <PrivacySections {...props} />,
      }}
    />
  );
}

/**
 * Privacy's three groups, each saving its own way (round 38 #61c, round
 * 41 #86b): WHO SEES NEW RUNS is a form with its Save, its legend the
 * group's kicker (round 42 #92); PUBLIC PROFILE and
 * ANONYMOUS TOTALS save on toggle, so they sit after the form's end,
 * outside it, under a rule and a kicker that says so. A failure in either
 * is §4a's NOT CHANGED in its own group. The switches come after the
 * form, so Tab never passes them between its field and its Save.
 *
 * **The profile switch reaches into NEW RUNS**, so its saved state lives
 * here: the PUBLIC row shows only while the profile is public, and
 * turning the profile off can move a PUBLIC default to SHARED. NEW RUNS is
 * keyed by the profile's state, so it starts again from the saved default
 * whenever its rows change, never holding a pick it no longer offers.
 */
function PrivacySections({
  current,
  isVerified,
  saveSharing,
  saveCountInTotals,
  savePublicProfile,
  pickUsername,
}: SectionPageProps): JSX.Element {
  const [profile, setProfile] = useState({
    publicProfile: current.publicProfile,
    publicCloset: current.publicCloset,
  });
  const [savedDefault, setSavedDefault] = useState(current.defaultAudience);
  const [hasMoved, setHasMoved] = useState(false);

  function onProfileSaved(state: PublicProfileState): void {
    setHasMoved(
      savedDefault === "world" && state.defaultAudience !== savedDefault,
    );
    setProfile({
      publicProfile: state.publicProfile,
      publicCloset: state.publicCloset,
    });
    setSavedDefault(state.defaultAudience);
  }

  return (
    <>
      <SubPageGroup title={SHARE_DEFAULT_LEGEND}>
        <SharingForm
          key={String(profile.publicProfile)}
          current={{
            defaultAudience: savedDefault,
            publicProfile: profile.publicProfile,
          }}
          saveSharing={async (input) => {
            await saveSharing(input);
            setSavedDefault(input.data.defaultAudience);
          }}
        />
      </SubPageGroup>
      <GroupRule />
      <PublicProfileGroup
        initialHandle={current.username}
        pickUsername={pickUsername}
        switches={{
          ...profile,
          notice: hasMoved ? DEFAULT_MOVED_LINE : undefined,
          save: savePublicProfile,
          onSaved: onProfileSaved,
        }}
      />
      <GroupRule />
      <SubPageGroup title="Anonymous totals · Saves as you switch">
        <TotalsSwitch
          initial={current.countInTotals}
          isVerified={isVerified}
          save={saveCountInTotals}
        />
      </SubPageGroup>
    </>
  );
}

/**
 * PUBLIC PROFILE: round 41 #86b's switches under a handle, and before one
 * (round 42 #92) no switch — the line and "Pick a username" under the
 * kicker alone, which drops "Saves as you switch" while nothing does.
 * Once the sheet saves a handle, the switches appear, focused.
 */
function PublicProfileGroup({
  initialHandle,
  pickUsername,
  switches,
}: Readonly<{
  initialHandle: string | undefined;
  pickUsername: PickUsernameForm;
  switches: Omit<
    Parameters<typeof PublicProfileSwitches>[0],
    "handle" | "isJustShown"
  >;
}>): JSX.Element {
  const [handle, setHandle] = useState(initialHandle);
  const [isJustShown, setIsJustShown] = useState(false);
  if (handle === undefined) {
    return (
      <SubPageGroup title="Public profile">
        <NoHandleYet
          pickUsername={pickUsername}
          onClaimed={(username) => {
            setHandle(username);
            setIsJustShown(true);
          }}
        />
      </SubPageGroup>
    );
  }
  return (
    <SubPageGroup title="Public profile · Saves as you switch">
      <PublicProfileSwitches
        {...switches}
        handle={handle}
        isJustShown={isJustShown}
      />
    </SubPageGroup>
  );
}

/**
Round 38 #61c's rule between Privacy's groups, in --hairline-2.
*/
function GroupRule(): JSX.Element {
  return <hr className="m-0 border-0 border-t border-hairline-2" />;
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
