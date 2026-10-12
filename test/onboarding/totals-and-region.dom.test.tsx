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

import { COUNTRIES } from "../../src/lib/contracts/regions";
import {
  PRIVATE_COUNTED,
  PRIVATE_ONLY_YOU,
  PRIVATE_UNCONFIRMED,
  PrivateRunLine,
} from "../../src/modules/onboarding/components/PrivateRunLine";
import {
  REGION_HINT,
  RegionForm,
} from "../../src/modules/onboarding/components/Settings";
import {
  TOTALS_LABEL,
  TOTALS_OFF,
  TOTALS_ON,
  TotalsSwitch,
} from "../../src/modules/onboarding/components/TotalsSwitch";
import type { CurrentSettings } from "../../src/modules/onboarding/profile";

/**
 * D-108's in-app half: Settings › Sharing's "Count my runs in anonymous
 * totals" (D), A3's private line (E) and Settings › Region (round 30
 * (d)). The copy is round 32's and round 30's, quoted, not paraphrased.
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

function totalsBox() {
  return screen.getByRole("checkbox", { name: TOTALS_LABEL });
}

describe("TotalsSwitch (round 32, frames 1a and 1b)", () => {
  it("says the drawn copy, verbatim", () => {
    expect(TOTALS_LABEL).toBe("Count my runs in anonymous totals");
    expect(TOTALS_ON).toBe(
      "Shared and private runs add their temperature, kit and verdict to the guides and reports. Never your name, notes, photos, or where and when you ran.",
    );
    expect(TOTALS_OFF).toBe(
      "Off. Your runs leave the guides at tonight's update. Reports already published stay as they are.",
    );
  });

  it("is on by default with the on line, and links how the guides are made", async () => {
    await renderWithRouter(
      <TotalsSwitch initial save={vi.fn().mockResolvedValue(undefined)} />,
    );
    expect(totalsBox()).toBeChecked();
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_ON);
    // A placeholder target until the marketing site owns
    // /how-it-works#totals (design-deltas item 59).
    expect(
      screen.getByRole("link", { name: "How the guides are made" }),
    ).toHaveAttribute("href", "/privacy");
  });

  it("saves off on toggle, with no confirm, and swaps to the off line", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    await renderWithRouter(
      <TotalsSwitch initial save={save} onSaved={onSaved} />,
    );

    await user.click(totalsBox());

    expect(save).toHaveBeenCalledWith({ data: { countInTotals: false } });
    await waitFor(() => {
      expect(totalsBox()).not.toBeChecked();
    });
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_OFF);
    expect(onSaved).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves back on from off", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(<TotalsSwitch initial={false} save={save} />);
    expect(totalsBox()).not.toBeChecked();
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_OFF);

    await user.click(totalsBox());

    expect(save).toHaveBeenCalledWith({ data: { countInTotals: true } });
    await waitFor(() => {
      expect(totalsBox()).toHaveAccessibleDescription(TOTALS_ON);
    });
  });

  it("stays as it was under a NOT CHANGED band when the save fails, and Try again resends", async () => {
    const user = userEvent.setup();
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValue(undefined);
    const onSaved = vi.fn();
    await renderWithRouter(
      <TotalsSwitch initial save={save} onSaved={onSaved} />,
    );

    await user.click(totalsBox());

    const band = await screen.findByText("Not changed");
    expect(band.closest("[data-part='failure-band']")).not.toBeNull();
    expect(totalsBox()).toBeChecked();
    expect(totalsBox()).toHaveAccessibleDescription(TOTALS_ON);
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(totalsBox()).not.toBeChecked();
    });
    expect(save).toHaveBeenLastCalledWith({ data: { countInTotals: false } });
    expect(screen.queryByText("Not changed")).toBeNull();
  });

  it("holds the box read-only while the save is in flight", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const save = vi.fn(() => pending.promise);
    await renderWithRouter(<TotalsSwitch initial save={save} />);

    await user.click(totalsBox());
    expect(totalsBox()).toHaveAttribute("readonly");
    pending.resolve(undefined);
    await waitFor(() => {
      expect(totalsBox()).not.toHaveAttribute("readonly");
    });
  });
});

function line(props: { isVerified: boolean; countInTotals: boolean }) {
  return (
    <PrivateRunLine
      hintId="hint"
      {...props}
      saveCountInTotals={vi.fn().mockResolvedValue(undefined)}
    />
  );
}

describe("PrivateRunLine (round 32, frame 2a)", () => {
  it("says the drawn copy, verbatim", () => {
    expect(PRIVATE_UNCONFIRMED).toBe(
      "Confirm your email to share. This run saves private.",
    );
    expect(PRIVATE_ONLY_YOU).toBe("Only you see this run.");
    expect(PRIVATE_COUNTED).toBe(
      "Its kit and verdict still count, anonymously, in the guides.",
    );
  });

  it("opted in, says the run still counts, with Change", async () => {
    const { container } = await renderWithRouter(
      line({ isVerified: true, countInTotals: true }),
    );
    expect(container.querySelector("#hint")).toHaveTextContent(
      `${PRIVATE_ONLY_YOU} ${PRIVATE_COUNTED} Change`,
    );
    expect(screen.getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("opted out, is just the first sentence", async () => {
    const { container } = await renderWithRouter(
      line({ isVerified: true, countInTotals: false }),
    );
    expect(container.querySelector("#hint")?.textContent).toBe(
      PRIVATE_ONLY_YOU,
    );
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("unconfirmed, says round 27's line instead, whatever the setting", async () => {
    const { container } = await renderWithRouter(
      line({ isVerified: false, countInTotals: true }),
    );
    expect(container.querySelector("#hint")?.textContent).toBe(
      PRIVATE_UNCONFIRMED,
    );
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("opens the totals switch in a sheet that Done closes", async () => {
    const user = userEvent.setup();
    await renderWithRouter(line({ isVerified: true, countInTotals: true }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Change" }));
    const sheet = screen.getByRole("dialog", { name: "Sharing" });
    expect(
      within(sheet).getByRole("heading", { level: 2, name: "Sharing" }),
    ).toBeVisible();
    expect(within(sheet).getByRole("checkbox")).toBeChecked();

    await user.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const NO_REGION: CurrentSettings = {
  thermalLevel: 0,
  tempUnit: "f",
  distanceUnit: "mi",
  defaultAudience: "runners",
  countInTotals: true,
  region: {},
};

function countryField() {
  return screen.getByRole("combobox", { name: "Country" });
}

describe("RegionForm (round 30 (d))", () => {
  it("starts empty, with the drawn hint and no state field", async () => {
    await renderWithRouter(
      <RegionForm
        current={NO_REGION}
        saveRegion={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(countryField()).toHaveValue("");
    expect(
      screen.queryByRole("combobox", { name: "State or province" }),
    ).toBeNull();
    expect(REGION_HINT).toBe(
      "Used only in anonymous totals, like what runners in your state wear. Never shown to anyone.",
    );
    expect(screen.getByText(REGION_HINT)).toBeVisible();
    // Every country is offered, by name, after the empty choice.
    expect(within(countryField()).getAllByRole("option")).toHaveLength(
      COUNTRIES.length + 1,
    );
  });

  it("saves a country and its state", async () => {
    const user = userEvent.setup();
    const saveRegion = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      <RegionForm current={NO_REGION} saveRegion={saveRegion} />,
    );

    await user.selectOptions(countryField(), "United States");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "State or province" }),
      "Minnesota",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveRegion).toHaveBeenCalledWith({
      data: { country: "US", subdivision: "US-MN" },
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Region saved.");
    });
  });

  it("saves a country with no states alone, and offers no state field for it", async () => {
    const user = userEvent.setup();
    const saveRegion = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      <RegionForm current={NO_REGION} saveRegion={saveRegion} />,
    );

    await user.selectOptions(countryField(), "Norway");
    expect(
      screen.queryByRole("combobox", { name: "State or province" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveRegion).toHaveBeenCalledWith({
      data: { country: "NO", subdivision: undefined },
    });
  });

  it("shows a set region, drops the state with a new country, and clears both", async () => {
    const user = userEvent.setup();
    const saveRegion = vi.fn().mockResolvedValue(undefined);
    await renderWithRouter(
      <RegionForm
        current={{
          ...NO_REGION,
          region: { country: "US", subdivision: "US-MN" },
        }}
        saveRegion={saveRegion}
      />,
    );
    expect(countryField()).toHaveValue("US");
    expect(
      screen.getByRole("combobox", { name: "State or province" }),
    ).toHaveValue("US-MN");

    await user.selectOptions(countryField(), "Canada");
    expect(
      screen.getByRole("combobox", { name: "State or province" }),
    ).toHaveValue("");

    await user.selectOptions(countryField(), "—");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveRegion).toHaveBeenCalledWith({
      data: { country: undefined, subdivision: undefined },
    });
  });

  it("says Nothing saved when the save fails", async () => {
    const user = userEvent.setup();
    await renderWithRouter(
      <RegionForm
        current={NO_REGION}
        saveRegion={vi.fn().mockRejectedValue(new Error("D1 down"))}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing saved")).toBeVisible();
  });
});
