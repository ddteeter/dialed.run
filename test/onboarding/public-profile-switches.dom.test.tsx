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
    expect(screen.queryByRole("checkbox", { name: "Show my closet" })).toBeNull();
    expect(screen.queryByText(CLOSET_LINE)).toBeNull();
  });

  it("show Show my closet under a public profile, with its line, as saved", () => {
    render(switches({ publicProfile: true, publicCloset: true }));
    const profile = screen.getByRole("checkbox", { name: "Public profile" });
    expect(profile).toBeChecked();
    expect(profile).toHaveAccessibleDescription(ON_LINE);
    const closet = screen.getByRole("checkbox", { name: "Show my closet" });
    expect(closet).toBeChecked();
    expect(closet).toHaveAccessibleDescription(CLOSET_LINE);
    expect(screen.getByText(CLOSET_LINE)).toHaveClass(
      "m-0",
      "text-small",
      "text-muted",
    );
  });

  it("say your profile, not an address, before a handle is claimed", () => {
    expect(publicProfileLine(false, undefined)).toBe(
      "Off. Anyone signed out who opens your profile sees nothing. Public runs still open from their own links.",
    );
    expect(publicProfileLine(true, undefined)).toBe(
      "Anyone can see your public runs at your profile. No sign-in.",
    );
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
    const { rerender } = render(switches());
    expect(screen.queryByText(MOVED)).toBeNull();
    rerender(switches({ notice: MOVED }));
    expect(screen.getByText(MOVED)).toHaveClass("m-0", "text-small", "text-ink");
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
  savePublicProfile: Parameters<typeof SettingsSectionPage>[0]["savePublicProfile"],
  saveSharing: Parameters<typeof SettingsSectionPage>[0]["saveSharing"] = vi
    .fn()
    .mockResolvedValue(undefined),
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
      .mockResolvedValue(state({ publicCloset: true, defaultAudience: "runners" }));
    await renderWithRouter(privacy(PUBLIC_DEFAULT, save));
    expect(rowValues()).toStrictEqual(["private", "runners", "world"]);
    expect(screen.getByRole("radio", { name: "Public" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Public profile" }));

    expect(await screen.findByText(MOVED)).toBeVisible();
    expect(rowValues()).toStrictEqual(["private", "runners"]);
    expect(screen.getByRole("radio", { name: "Shared" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Public profile" }),
    ).not.toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Show my closet" })).toBeNull();
  });

  it("says nothing moved when the default was not PUBLIC", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(state({ defaultAudience: "private" }));
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
      .mockResolvedValue(state({ publicProfile: true, defaultAudience: "private" }));
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
      .mockResolvedValue(state({ publicProfile: true, defaultAudience: "runners" }));
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
});
