import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CitySuggestion } from "../../src/modules/onboarding/cities";
import { CalibrateForm } from "../../src/modules/onboarding/components/CalibrateForm";
import type { Calibration } from "../../src/modules/onboarding/inputs";

/**
 * Screen O1, with round 22's location step (item 19). The behaviour that
 * matters is what a runner can finish *without*: no location, no city, no
 * unit change. One question.
 */
const DEFAULTS = { temp: "f", distance: "mi" } as const;

const MINNEAPOLIS: CitySuggestion = {
  label: "Minneapolis, Minnesota",
  lat: 44.98,
  lng: -93.27,
};

function renderForm(
  overrides: {
    locate?: () => Promise<{ lat: number; lng: number } | undefined>;
    searchCities?: (input: {
      data: { query: string };
    }) => Promise<readonly CitySuggestion[]>;
    defaults?: { temp: "f" | "c"; distance: "mi" | "km" };
  } = {},
) {
  // Typed and echoing its input, so `mock.calls[0]` has a shape.
  const save = vi.fn((input: { data: Calibration }) => Promise.resolve(input));
  const onSaved = vi.fn();
  const searchCities = vi.fn(
    overrides.searchCities ?? (() => Promise.resolve([])),
  );
  render(
    <CalibrateForm
      defaults={overrides.defaults ?? DEFAULTS}
      locate={overrides.locate ?? (() => Promise.resolve(undefined))}
      searchCities={searchCities}
      saveCalibration={save}
      onSaved={onSaved}
    />,
  );
  return { save, onSaved, searchCities, user: userEvent.setup() };
}

const submit = () => screen.getByRole("button", { name: "Start running" });
const locateButton = () =>
  screen.getByRole("button", { name: "Use my location" });

describe("the question", () => {
  it("asks the design's question, with its five answers and their offsets", () => {
    renderForm();

    expect(
      screen.getByRole("group", {
        name: "Compared to people you run with, do you run warm or cold?",
      }),
    ).toBeInTheDocument();
    const offsets: readonly (readonly [string, string])[] = [
      ["Always freezing", "+8\u{00B0}"],
      ["Run a little cold", "+4\u{00B0}"],
      ["About average", "0\u{00B0}"],
      ["Run a little warm", "\u{2212}4\u{00B0}"],
      ["Sweating in a t-shirt at 40°", "\u{2212}8\u{00B0}"],
    ];
    for (const [answer, offset] of offsets) {
      expect(
        screen.getByLabelText(new RegExp(`^${answer}`, "u")).closest("label"),
      ).toHaveTextContent(offset);
    }
  });

  it("moves the offsets when the unit changes", async () => {
    const { user } = renderForm();
    const alwaysFreezing = () =>
      screen.getByLabelText(/^Always freezing/u).closest("label");
    expect(alwaysFreezing()).toHaveTextContent("+8°");

    await user.click(screen.getByRole("radio", { name: "°C" }));

    expect(alwaysFreezing()).toHaveTextContent("+4°");
  });

  it("finishes on the one required answer", async () => {
    const { user, save, onSaved } = renderForm();

    await user.click(screen.getByLabelText(/^Always freezing/u));
    await user.click(submit());

    expect(save).toHaveBeenCalledWith({
      data: {
        thermalLevel: 2,
        cityLabel: undefined,
        lat: undefined,
        lng: undefined,
        tempUnit: "f",
        distanceUnit: "mi",
      },
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Calibrated.");
  });

  it("writes the negative end of the scale as a negative number", async () => {
    const { user, save } = renderForm();

    await user.click(screen.getByLabelText(/^Sweating in a t-shirt at 40°/u));
    await user.click(submit());

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { thermalLevel: -2 },
    });
  });

  it("refuses to submit with no answer, in the schema's words", async () => {
    const { user, save } = renderForm();

    await user.click(submit());

    expect(save).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Pick the one that sounds most like you."),
    ).toBeVisible();
    // Never the `disabled` attribute on a submit.
    expect(submit()).not.toHaveAttribute("disabled");
  });
});

describe("where you run: typed and suggested (round 22, item 19)", () => {
  it("carries a typed city that was never picked, as a label alone", async () => {
    const { user, save } = renderForm();

    await user.click(screen.getByLabelText(/^About average/u));
    await user.type(screen.getByLabelText("Where you run"), "  Seattle, WA  ");
    await user.click(submit());

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: "Seattle, WA", lat: undefined, lng: undefined },
    });
  });

  it("sends no city for a field of spaces", async () => {
    const { user, save } = renderForm();

    await user.click(screen.getByLabelText(/^About average/u));
    await user.type(screen.getByLabelText("Where you run"), " ".repeat(3));
    await user.click(submit());

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: undefined },
    });
  });

  it("suggests as you type, and picking one makes the chip", async () => {
    const { user, save, searchCities } = renderForm({
      searchCities: () => Promise.resolve([MINNEAPOLIS]),
    });

    await user.type(screen.getByLabelText("Where you run"), "Mi");
    expect(searchCities).toHaveBeenLastCalledWith({ data: { query: "Mi" } });
    const list = await screen.findByRole("list", { name: "Cities" });
    expect(list).toHaveAttribute("data-part", "city-suggestions");

    await user.click(
      screen.getByRole("button", { name: "Minneapolis, Minnesota" }),
    );

    const chip = document.querySelector("[data-part='city-chip']");
    expect(chip).toHaveTextContent("Minneapolis, Minnesota");
    expect(screen.queryByLabelText("Where you run")).toBeNull();
    expect(screen.queryByRole("list", { name: "Cities" })).toBeNull();

    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: "Minneapolis, Minnesota", lat: 44.98, lng: -93.27 },
    });
  });

  it("puts the field back, empty, when the chip is changed", async () => {
    const { user } = renderForm({
      searchCities: () => Promise.resolve([MINNEAPOLIS]),
    });
    await user.type(screen.getByLabelText("Where you run"), "Mi");
    await user.click(
      await screen.findByRole("button", { name: "Minneapolis, Minnesota" }),
    );

    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByLabelText("Where you run")).toHaveValue("");
    expect(document.querySelector("[data-part='city-chip']")).toBeNull();
    // The old suggestions do not come back with it.
    expect(screen.queryByRole("list", { name: "Cities" })).toBeNull();
  });

  it("drops an answer for text the runner has since typed past", async () => {
    const late = Promise.withResolvers<readonly CitySuggestion[]>();
    const { user } = renderForm({
      searchCities: ({ data }) =>
        data.query === "Mi" ? late.promise : Promise.resolve([]),
    });

    await user.type(screen.getByLabelText("Where you run"), "Mi");
    await user.type(screen.getByLabelText("Where you run"), "x");
    await act(async () => {
      late.resolve([MINNEAPOLIS]);
      await late.promise;
    });

    expect(screen.queryByRole("list", { name: "Cities" })).toBeNull();
  });

  it("shows nothing, and keeps the field, when suggesting fails", async () => {
    const { user } = renderForm({
      searchCities: ({ data }) =>
        data.query === "M"
          ? Promise.resolve([MINNEAPOLIS])
          : Promise.reject(new Error("down")),
    });

    await user.type(screen.getByLabelText("Where you run"), "M");
    await screen.findByRole("list", { name: "Cities" });
    await user.type(screen.getByLabelText("Where you run"), "i");

    await waitFor(() => {
      expect(screen.queryByRole("list", { name: "Cities" })).toBeNull();
    });
    expect(screen.getByLabelText("Where you run")).toHaveValue("Mi");
    expect(screen.queryByText(/didn't|try again/iu)).toBeNull();
  });

  it("ignores a failure for text the runner has since typed past", async () => {
    const late = Promise.withResolvers<readonly CitySuggestion[]>();
    const { user } = renderForm({
      searchCities: ({ data }) =>
        data.query === "M" ? late.promise : Promise.resolve([MINNEAPOLIS]),
    });

    await user.type(screen.getByLabelText("Where you run"), "M");
    await user.type(screen.getByLabelText("Where you run"), "i");
    await screen.findByRole("list", { name: "Cities" });
    await act(async () => {
      late.reject(new Error("down"));
      await Promise.allSettled([late.promise]);
    });

    expect(screen.getByRole("list", { name: "Cities" })).toBeInTheDocument();
  });
});

describe("Use my location (round 22, item 19)", () => {
  it("is a text button under the field that breathes while it asks", async () => {
    const answer = Promise.withResolvers<{ lat: number; lng: number }>();
    const { user } = renderForm({ locate: () => answer.promise });

    await user.click(locateButton());

    expect(locateButton()).toHaveAttribute("aria-busy", "true");
    expect(locateButton()).not.toHaveAttribute("disabled");
    expect(locateButton().querySelectorAll(".breathe")).toHaveLength(2);
    expect(locateButton()).toHaveClass("underline");

    await act(async () => {
      answer.resolve({ lat: 44.98, lng: -93.27 });
      await answer.promise;
    });
  });

  it("asks once however often it is pressed while asking", async () => {
    const answer = Promise.withResolvers<undefined>();
    const locate = vi.fn(() => answer.promise);
    const { user } = renderForm({ locate });

    await user.click(locateButton());
    await user.click(locateButton());
    expect(locate).toHaveBeenCalledTimes(1);

    await act(async () => {
      answer.resolve(undefined);
      await answer.promise;
    });
  });

  it("becomes the chip when granted, and the coordinates are carried", async () => {
    const { user, save } = renderForm({
      locate: () => Promise.resolve({ lat: 44.98, lng: -93.27 }),
    });

    await user.click(locateButton());

    const chip = await waitFor(() => {
      const found = document.querySelector("[data-part='city-chip']");
      expect(found).not.toBeNull();
      return found;
    });
    // Located, not named: a measured value, in brackets.
    expect(chip).toHaveTextContent("[44.98, -93.27]");

    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: undefined, lat: 44.98, lng: -93.27 },
    });
  });

  it("when denied, says so plainly and puts focus in the field — never a failure", async () => {
    const { user, save } = renderForm({
      locate: () => Promise.resolve(undefined),
    });

    await user.click(locateButton());

    const line = await screen.findByText(
      "Location’s off. Type your city instead.",
    );
    expect(line).toHaveClass("text-quiet");
    expect(line.className).not.toMatch(/failure|hiviz/u);
    await waitFor(() => {
      expect(screen.getByLabelText("Where you run")).toHaveFocus();
    });
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
    expect(locateButton()).not.toHaveAttribute("aria-busy");

    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("clears the denied line when asked again", async () => {
    const answers = [undefined, { lat: 1, lng: 2 }];
    const { user } = renderForm({
      locate: () => Promise.resolve(answers.shift()),
    });
    await user.click(locateButton());
    await screen.findByText("Location’s off. Type your city instead.");

    await user.click(locateButton());

    await waitFor(() => {
      expect(
        screen.queryByText("Location’s off. Type your city instead."),
      ).toBeNull();
    });
  });

  it("says nothing about location before it has been asked", () => {
    renderForm();
    expect(screen.queryByText(/Location’s off/u)).toBeNull();
    expect(document.querySelector("[data-part='city-chip']")).toBeNull();
  });
});

describe("units: two segmented pairs (round 22, item 19)", () => {
  it("offers °F/°C and mi/km, defaulted from the locale", () => {
    renderForm({ defaults: { temp: "c", distance: "km" } });

    expect(
      screen.getByRole("group", { name: "Temperature" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Distance" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "°C" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "°F" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "km" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "mi" })).not.toBeChecked();
  });

  it("sends what the runner picked", async () => {
    const { user, save } = renderForm();

    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(screen.getByRole("radio", { name: "°C" }));
    await user.click(screen.getByRole("radio", { name: "km" }));
    await user.click(submit());

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { tempUnit: "c", distanceUnit: "km" },
    });
  });
});
