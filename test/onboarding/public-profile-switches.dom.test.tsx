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

import { HandleForm } from "../../src/modules/account/components/HandleForm";
import type { HandleClaim } from "../../src/modules/account/username";
import {
  NO_HANDLE_LINE,
  type PickUsernameForm,
} from "../../src/modules/onboarding/components/PickUsername";
import {
  publicProfileLine,
  PublicProfileSwitches,
} from "../../src/modules/onboarding/components/PublicProfileSwitches";
import { SettingsSectionPage } from "../../src/modules/onboarding/components/SettingsSubPage";
import type { CurrentSettings } from "../../src/modules/onboarding/profile";
import type { PublicProfileState } from "../../src/modules/onboarding/public-profile";

/**
 * Settings › Privacy's PUBLIC PROFILE group (D-149; round 41 #86b).
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({
      initialEntries: ["/onboarding/settings/sharing"],
    }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const OFF_LINE =
  "Off. Anyone signed out who opens app.dialed.run/@maya_runs sees nothing. Public runs still open from their own links.";
const ON_LINE =
  "Anyone can see your public runs at app.dialed.run/@maya_runs. No sign-in.";
const CLOSET_LINE =
  "Pieces in use, shoe mileage and retired pieces, on your public profile. Never notes or flags.";
const MOVED = "New runs now default to Shared.";

function state(overrides: Partial<PublicProfileState>): PublicProfileState {
  return {
    publicProfile: false,
    publicCloset: false,
    defaultAudience: "runners",
    ...overrides,
  };
}

function switches(
  props: Partial<Parameters<typeof PublicProfileSwitches>[0]> = {},
) {
  return (
    <PublicProfileSwitches
      publicProfile={false}
      publicCloset={false}
      handle="maya_runs"
      notice={undefined}
      save={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />
  );
}

describe("the PUBLIC PROFILE switches", () => {
  it("are off by default, say so with the runner's own address, and hide Show my closet", () => {
    render(switches());
    const profile = screen.getByRole("checkbox", { name: "Public profile" });
    expect(profile).not.toBeChecked();
    expect(profile).toHaveAccessibleDescription(OFF_LINE);
    expect(screen.getByText(OFF_LINE)).toHaveClass(
      "m-0",
      "text-small",
      "text-muted",
    );
    expect(
      screen.queryByRole("checkbox", { name: "Show my closet" }),
    ).toBeNull();
    expect(screen.queryByText(CLOSET_LINE)).toBeNull();
  });

  it("show Show my closet under a public profile, with its line, as saved", () => {
    render(switches({ publicProfile: true, publicCloset: true }));
    const profile = screen.getByRole("checkbox", { name: "Public profile" });
    expect(profile).toBeChecked();
    expect(profile).toHaveAccessibleDescription(ON_LINE);
    const closet = screen.getByRole("checkbox", { name: "Show my closet" });
    expect(closet).toBeChecked();
    // Each field by the column it saves.
    expect(profile).toHaveAttribute("name", "publicProfile");
    expect(closet).toHaveAttribute("name", "publicCloset");
    expect(closet).toHaveAccessibleDescription(CLOSET_LINE);
    expect(screen.getByText(CLOSET_LINE)).toHaveClass(
      "m-0",
      "text-small",
      "text-muted",
    );
  });

  it("name the runner's address in both lines", () => {
    expect(publicProfileLine(false, "maya_runs")).toBe(OFF_LINE);
    expect(publicProfileLine(true, "maya_runs")).toBe(ON_LINE);
  });

  it("take no focus on arrival unless they were just unlocked", () => {
    render(switches());
    expect(
      screen.getByRole("checkbox", { name: "Public profile" }),
    ).not.toHaveFocus();
  });

  it("save each switch on its own, and hand the saved state up", async () => {
    const user = userEvent.setup();
    const saved = state({ publicProfile: true });
    const save = vi.fn().mockResolvedValue(saved);
    const onSaved = vi.fn();
    const { rerender } = render(switches({ save, onSaved }));

    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    expect(save).toHaveBeenCalledWith({ data: { publicProfile: true } });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(saved);
    });

    rerender(switches({ save, onSaved, publicProfile: true }));
    await user.click(screen.getByRole("checkbox", { name: "Show my closet" }));
    expect(save).toHaveBeenLastCalledWith({ data: { publicCloset: true } });

    rerender(
      switches({ save, onSaved, publicProfile: true, publicCloset: true }),
    );
    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    expect(save).toHaveBeenLastCalledWith({ data: { publicProfile: false } });
  });

  it("are read-only while a save is in flight, and keep the saved state", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<PublicProfileState>();
    const save = vi.fn(() => pending.promise);
    render(switches({ save, publicProfile: true }));
    const profile = screen.getByRole("checkbox", { name: "Public profile" });
    const closet = screen.getByRole("checkbox", { name: "Show my closet" });
    expect(profile).not.toHaveAttribute("readonly");

    await user.click(closet);
    expect(profile).toHaveAttribute("readonly");
    expect(closet).toHaveAttribute("readonly");
    expect(closet).not.toBeChecked();
    pending.resolve(state({ publicProfile: true, publicCloset: true }));
    await waitFor(() => {
      expect(closet).not.toHaveAttribute("readonly");
    });
  });

  it("say Not changed when a save fails, and leave the switch as it was", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error("D1"));
    render(switches({ save, onSaved }));
    const profile = screen.getByRole("checkbox", { name: "Public profile" });
    await user.click(profile);
    expect(await screen.findByText("Not changed")).toBeVisible();
    expect(profile).not.toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("show the caller's notice, in ink, and nothing without one", () => {
    const { container, rerender } = render(switches());
    expect(screen.queryByText(MOVED)).toBeNull();
    // Not even an empty line: the profile's own line is the only one.
    expect(container.querySelectorAll("p")).toHaveLength(1);
    rerender(switches({ notice: MOVED }));
    expect(screen.getByText(MOVED)).toHaveClass(
      "m-0",
      "text-small",
      "text-ink",
    );
  });
});

const PUBLIC_DEFAULT: CurrentSettings = {
  thermalLevel: 0,
  tempUnit: "f",
  distanceUnit: "mi",
  defaultAudience: "world",
  countInTotals: true,
  publicProfile: true,
  publicCloset: true,
  username: "maya_runs",
};

function privacy(
  current: CurrentSettings,
  savePublicProfile: Parameters<
    typeof SettingsSectionPage
  >[0]["savePublicProfile"],
  saveSharing: Parameters<typeof SettingsSectionPage>[0]["saveSharing"] = vi
    .fn()
    .mockResolvedValue(undefined),
  pickUsername: PickUsernameForm = vi.fn(),
) {
  return (
    <SettingsSectionPage
      section="sharing"
      current={current}
      isVerified
      saveUnits={vi.fn()}
      saveSharing={saveSharing}
      saveCountInTotals={vi.fn()}
      savePublicProfile={savePublicProfile}
      pickUsername={pickUsername}
    />
  );
}

function newRuns() {
  return screen.getByRole("group", { name: "Who sees new runs" });
}

function rowValues() {
  return within(newRuns())
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("value"));
}

describe("Privacy with the PUBLIC PROFILE group (round 41 #86b)", () => {
  it("moves a PUBLIC default to SHARED when the profile goes off, and says so", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue(
        state({ publicCloset: true, defaultAudience: "runners" }),
      );
    await renderWithRouter(privacy(PUBLIC_DEFAULT, save));
    expect(rowValues()).toStrictEqual(["private", "runners", "world"]);
    expect(screen.getByRole("radio", { name: "Public" })).toBeChecked();
    expect(screen.queryByText(MOVED)).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));

    expect(await screen.findByText(MOVED)).toBeVisible();
    expect(rowValues()).toStrictEqual(["private", "runners"]);
    expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Public profile" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: "Show my closet" }),
    ).toBeNull();
  });

  it("says nothing moved when the default was not PUBLIC", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue(state({ defaultAudience: "private" }));
    await renderWithRouter(
      privacy({ ...PUBLIC_DEFAULT, defaultAudience: "private" }, save),
    );
    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    await waitFor(() => {
      expect(rowValues()).toStrictEqual(["private", "runners"]);
    });
    expect(screen.getByRole("radio", { name: "Private" })).toBeChecked();
    expect(screen.queryByText(MOVED)).toBeNull();
  });

  it("clears the notice at the next switch, and offers PUBLIC again once the profile is back on", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValueOnce(state({ defaultAudience: "runners" }))
      .mockResolvedValueOnce(
        state({ publicProfile: true, defaultAudience: "runners" }),
      );
    await renderWithRouter(privacy(PUBLIC_DEFAULT, save));
    const profile = screen.getByRole("checkbox", { name: "Public profile" });

    await user.click(profile);
    await screen.findByText(MOVED);
    await user.click(profile);

    await waitFor(() => {
      expect(rowValues()).toStrictEqual(["private", "runners", "world"]);
    });
    expect(screen.queryByText(MOVED)).toBeNull();
    expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
  });

  it("starts NEW RUNS from the default it last saved when the rows change", async () => {
    // The form is keyed by the profile's state; a save of its own must
    // be what it starts again from, not the default the page loaded with.
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue(
        state({ publicProfile: true, defaultAudience: "private" }),
      );
    const saveSharing = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      privacy(
        {
          ...PUBLIC_DEFAULT,
          defaultAudience: "runners",
          publicProfile: false,
          publicCloset: false,
        },
        save,
        saveSharing,
      ),
    );
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(saveSharing).toHaveBeenCalledWith({
        data: { defaultAudience: "private" },
      });
    });

    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    await waitFor(() => {
      expect(rowValues()).toStrictEqual(["private", "runners", "world"]);
    });
    expect(screen.getByRole("radio", { name: "Private" })).toBeChecked();
    expect(screen.queryByText(MOVED)).toBeNull();
  });

  it("keeps the default where it was when a sharing save fails", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue(
        state({ publicProfile: true, defaultAudience: "runners" }),
      );
    const saveSharing = vi.fn().mockRejectedValue(new Error("D1"));
    await renderWithRouter(
      privacy(
        { ...PUBLIC_DEFAULT, defaultAudience: "runners", publicProfile: false },
        save,
        saveSharing,
      ),
    );
    await user.click(screen.getByRole("radio", { name: "Private" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing saved")).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    await waitFor(() => {
      expect(rowValues()).toStrictEqual(["private", "runners", "world"]);
    });
    expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
  });

  it("names the runner's handle in the profile's line", async () => {
    await renderWithRouter(privacy(PUBLIC_DEFAULT, vi.fn()));
    expect(
      screen.getByRole("checkbox", { name: "Public profile" }),
    ).toHaveAccessibleDescription(ON_LINE);
  });

  it("says nothing moved when a switch leaves a PUBLIC default where it was", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(
      state({
        publicProfile: true,
        publicCloset: false,
        defaultAudience: "world",
      }),
    );
    await renderWithRouter(privacy(PUBLIC_DEFAULT, save));
    await user.click(screen.getByRole("checkbox", { name: "Show my closet" }));
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "Show my closet" }),
      ).not.toBeChecked();
    });
    expect(screen.queryByText(MOVED)).toBeNull();
  });

  it("says nothing moved when the default changed but was never PUBLIC", async () => {
    // A default changed in another tab comes back with the switch; only
    // PUBLIC going to SHARED is this switch's doing.
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue(state({ defaultAudience: "runners" }));
    await renderWithRouter(
      privacy({ ...PUBLIC_DEFAULT, defaultAudience: "private" }, save),
    );
    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
    });
    expect(screen.queryByText(MOVED)).toBeNull();
  });

  it("knows a PUBLIC default saved on the page, so turning the profile off says it moved", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockResolvedValue(state({ defaultAudience: "runners" }));
    const saveSharing = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      privacy(
        { ...PUBLIC_DEFAULT, defaultAudience: "runners" },
        save,
        saveSharing,
      ),
    );
    await user.click(screen.getByRole("radio", { name: "Public" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(saveSharing).toHaveBeenCalledWith({
        data: { defaultAudience: "world" },
      });
    });

    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));
    expect(await screen.findByText(MOVED)).toBeVisible();
  });
});

/**
 * The route's username form, as `$section.tsx` builds it: Settings ›
 * Username's form and words, its claim answered here.
 */
function usernameForm(
  claim: (input: { data: { username: string } }) => Promise<HandleClaim>,
): PickUsernameForm {
  return (onClaimed) => (
    <HandleForm
      claim={claim}
      submitLabel="Save"
      pendingLabel="Saving"
      successMessage="Username saved."
      onClaimed={onClaimed}
    />
  );
}

const NO_HANDLE: CurrentSettings = {
  ...PUBLIC_DEFAULT,
  defaultAudience: "runners",
  publicProfile: false,
  publicCloset: false,
  username: undefined,
};

describe("Privacy before the runner has a handle (round 42 #92)", () => {
  it("has no switch: the kicker alone, the line, and Pick a username", async () => {
    await renderWithRouter(privacy(NO_HANDLE, vi.fn()));

    const kicker = screen.getByRole("heading", {
      level: 2,
      name: "Public profile",
    });
    const group = kicker.closest("section");
    expect(
      screen.queryByRole("checkbox", { name: "Public profile" }),
    ).toBeNull();
    expect(screen.getByText(NO_HANDLE_LINE)).toHaveClass("m-0", "text-body");
    expect(NO_HANDLE_LINE).toBe(
      "A public profile lives at your username. Pick one first.",
    );
    const pick = screen.getByRole("button", { name: "Pick a username" });
    expect(group).toContainElement(pick);
    expect(pick).toHaveAttribute("aria-haspopup", "dialog");
    expect(pick).toHaveClass("target", "rounded-pill", "border-hairline");
    // NEW RUNS still has no PUBLIC row, with its line in its place.
    expect(rowValues()).toStrictEqual(["private", "runners"]);
    expect(screen.getByText(/^Public is a choice here/u)).toBeVisible();
  });

  it("opens the username sheet, and on save shows the switch, focused, under its address", async () => {
    const user = userEvent.setup();
    const claim = vi.fn(
      (input: { data: { username: string } }): Promise<HandleClaim> =>
        Promise.resolve({ kind: "claimed", username: input.data.username }),
    );
    await renderWithRouter(
      privacy(NO_HANDLE, vi.fn(), undefined, usernameForm(claim)),
    );
    expect(screen.queryByRole("textbox", { name: "Username" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pick a username" }));
    const sheet = screen.getByRole("dialog", { name: "Username" });
    expect(sheet).toHaveAttribute("open");
    expect(
      within(sheet).getByRole("heading", { level: 2, name: "Username" }),
    ).toBeVisible();
    await user.type(
      within(sheet).getByRole("textbox", { name: "Username" }),
      "maya_runs",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    const profile = await screen.findByRole("checkbox", {
      name: "Public profile",
    });
    expect(claim).toHaveBeenCalledExactlyOnceWith({
      data: { username: "maya_runs" },
    });
    expect(profile).toHaveAccessibleDescription(OFF_LINE);
    expect(profile).toHaveFocus();
    // The sheet went with the line and the press.
    expect(sheet).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Public profile · Saves as you switch",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Pick a username" }),
    ).toBeNull();
  });

  it("closes the sheet with its Close and keeps the line, the form gone until it opens again", async () => {
    const user = userEvent.setup();
    const claim = vi.fn();
    await renderWithRouter(
      privacy(NO_HANDLE, vi.fn(), undefined, usernameForm(claim)),
    );

    await user.click(screen.getByRole("button", { name: "Pick a username" }));
    const sheet = screen.getByRole("dialog", { name: "Username" });
    await user.type(
      within(sheet).getByRole("textbox", { name: "Username" }),
      "maya",
    );
    await user.click(within(sheet).getByRole("button", { name: "Close" }));

    expect(sheet).not.toHaveAttribute("open");
    expect(screen.queryByRole("textbox", { name: "Username" })).toBeNull();
    expect(screen.getByText(NO_HANDLE_LINE)).toBeVisible();
    expect(claim).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Pick a username" }));
    expect(screen.getByRole("textbox", { name: "Username" })).toHaveValue("");
  });

  it("keeps the line when the handle is taken, the sheet open on the refusal", async () => {
    const user = userEvent.setup();
    const claim = vi.fn((): Promise<HandleClaim> =>
      Promise.resolve({
        kind: "taken",
        username: "maya_runs",
        suggestion: undefined,
      }),
    );
    await renderWithRouter(
      privacy(NO_HANDLE, vi.fn(), undefined, usernameForm(claim)),
    );

    await user.click(screen.getByRole("button", { name: "Pick a username" }));
    const sheet = screen.getByRole("dialog", { name: "Username" });
    await user.type(
      within(sheet).getByRole("textbox", { name: "Username" }),
      "maya_runs",
    );
    await user.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(claim).toHaveBeenCalledOnce();
    });
    expect(sheet).toHaveAttribute("open");
    expect(
      screen.queryByRole("checkbox", { name: "Public profile" }),
    ).toBeNull();
  });
});
