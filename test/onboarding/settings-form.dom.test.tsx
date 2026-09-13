import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsForm } from "../../src/modules/onboarding/components/SettingsForm";
import type { Preferences } from "../../src/modules/onboarding/inputs";
import type { CurrentSettings } from "../../src/modules/onboarding/profile";

/**
 * Settings — the three rows this packet owns out of design's U1.
 *
 * The assertion design cares most about is the one about *reading*: "a
 * settings list you can read without opening anything". So the calibration
 * row has to state the answer and the offset without a tap.
 */
const SETTINGS: CurrentSettings = {
  thermalLevel: 0,
  tempUnit: "f",
  distanceUnit: "mi",
  shareDefault: true,
};

async function renderForm(overrides: Partial<CurrentSettings> = {}) {
  const save = vi.fn((input: { data: Preferences }) => Promise.resolve(input));
  const element = (
    <SettingsForm
      current={{ ...SETTINGS, ...overrides }}
      savePreferences={save}
    />
  );
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return save;
}

describe("SettingsForm", () => {
  it("opens on what is already saved, not on the app defaults", async () => {
    // A settings screen that rendered defaults would quietly offer to
    // overwrite a choice with the thing the user changed it away from.
    await renderForm({ tempUnit: "c", distanceUnit: "km", shareDefault: false });

    expect(screen.getByLabelText("Temperature")).toHaveValue("c");
    expect(screen.getByLabelText("Distance")).toHaveValue("km");
    expect(
      screen.getByLabelText("Share to feed by default"),
    ).not.toBeChecked();
  });

  it("states the calibration and its offset, without opening anything", async () => {
    await renderForm({ thermalLevel: 2 });

    expect(screen.getByText(/Currently Always freezing/)).toBeVisible();
    expect(screen.getByText("+8°")).toBeVisible();
  });

  it("moves the stated offset with the unit on screen", async () => {
    // The unit selected above, not the unit saved — the select is what the
    // person is looking at, and watching the number move is O1's "you'll
    // see it change" promise demonstrated before a save.
    await renderForm({ thermalLevel: 2 });
    expect(screen.getByText("+8°")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Temperature"), {
      target: { value: "c" },
    });

    expect(screen.getByText("+4°")).toBeVisible();
    expect(screen.queryByText("+8°")).toBeNull();
  });

  it("invents no offset for someone who never answered", async () => {
    // Reachable: every step past O1 is skippable and O1 itself can be left.
    // "Currently unset, 0° offset" would be a measured value made up on
    // behalf of someone who has not given one.
    await renderForm({ thermalLevel: undefined });

    expect(screen.getByText("Not answered yet.")).toBeVisible();
    expect(screen.queryByText(/Currently/)).toBeNull();
    expect(screen.queryByText(/0°/)).toBeNull();
  });

  it("reaches O1 to recalibrate, rather than asking again here", async () => {
    // Requirement 6. A link, not a fourth control: the question is five
    // answers with a visible offset, and a control that navigated away
    // mid-form would lose the unsaved units beside it.
    await renderForm();

    expect(screen.getByRole("link", { name: "Recalibrate" })).toHaveAttribute(
      "href",
      "/onboarding/calibrate",
    );
  });

  it("saves all three together", async () => {
    const user = userEvent.setup();
    const save = await renderForm();

    await user.selectOptions(screen.getByLabelText("Temperature"), "c");
    await user.selectOptions(screen.getByLabelText("Distance"), "km");
    await user.click(screen.getByLabelText("Share to feed by default"));
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(save).toHaveBeenCalledWith({
      data: { tempUnit: "c", distanceUnit: "km", shareDefault: false },
    });
  });

  it("saves the values on screen when nothing was touched", async () => {
    // Confirming without changing is a real interaction, and it must write
    // what is displayed rather than an empty patch.
    const user = userEvent.setup();
    const save = await renderForm({ shareDefault: false });

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(save).toHaveBeenCalledWith({
      data: { tempUnit: "f", distanceUnit: "mi", shareDefault: false },
    });
  });

  it("announces the save into the one live region", async () => {
    const user = userEvent.setup();
    await renderForm();

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Settings saved.");
    });
  });

  it("keeps the values and offers a retry when the save fails", async () => {
    const user = userEvent.setup();
    const save = vi.fn(() => Promise.reject(new Error("D1 is down")));
    const rootRoute = createRootRoute({
      component: () => (
        <SettingsForm current={SETTINGS} savePreferences={save} />
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);

    await user.selectOptions(screen.getByLabelText("Temperature"), "c");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(screen.getByText("Our end failed. Nothing changed.")).toBeVisible();
    // Nothing is cleared, so `Try again` resubmits exactly what was chosen.
    expect(screen.getByLabelText("Temperature")).toHaveValue("c");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("names both options in each unit select", async () => {
    // The words, not the codes: a select whose options read "f" and "c" is
    // the same control and a different screen.
    await renderForm();

    const temperature = screen.getByLabelText("Temperature");
    expect(temperature).toHaveTextContent("Fahrenheit");
    expect(temperature).toHaveTextContent("Celsius");

    const distance = screen.getByLabelText("Distance");
    expect(distance).toHaveTextContent("Miles");
    expect(distance).toHaveTextContent("Kilometres");
  });

  it("reads as one sentence, separators included", async () => {
    // `toHaveTextContent` normalises whitespace across children, so it
    // passes whether or not the space between the answer and the offset is
    // there. Reading the row's own text is what catches a missing
    // separator — "About average0° offset".
    await renderForm({ thermalLevel: 0 });

    const row = screen.getByText(/^Currently/);

    expect(row.textContent).toBe("Currently About average, 0° offset");
  });

  it("falls back to the saved unit when the select is cleared", async () => {
    // `ChoiceField` carries an empty option, so "" is a state a person can
    // reach. The stated offset has to keep a unit through it, and the
    // saved one is the only honest choice.
    //
    // **Fahrenheit is the saved unit here on purpose.** With Celsius saved
    // this assertion passes either way: dropping the fallback passes `""`
    // straight through, and `""` is not `"f"`, so the offset comes out in
    // Celsius — the same number the fallback would have produced. Only a
    // saved unit that differs from the not-Fahrenheit default can tell the
    // two apart.
    await renderForm({ thermalLevel: 2, tempUnit: "f" });
    expect(screen.getByText("+8°")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Temperature"), {
      target: { value: "" },
    });

    expect(screen.getByText("+8°")).toBeVisible();
    expect(screen.queryByText("+4°")).toBeNull();
  });

  it("never lets the browser submit the form itself", async () => {
    // `noValidate` plus `preventDefault`: without the second the page
    // navigates away mid-submit and the handler's result is lost.
    const user = userEvent.setup();
    await renderForm();

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Save settings" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("says the sharing default is per-run, because it is", async () => {
    // Product rule: public by default, with a per-entry toggle *and* a
    // per-user default. This screen owns the third of those and must not
    // read as a lock on the second.
    await renderForm();

    expect(screen.getByText("You can flip it per run.")).toBeVisible();
  });
});
