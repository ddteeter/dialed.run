import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CalibrateForm } from "../../src/modules/onboarding/components/CalibrateForm";
import type { Calibration } from "../../src/modules/onboarding/inputs";
import type { CityLookup } from "../../src/modules/onboarding/place";

/**
 * Screen O1, with round 22's location step (item 19). The behaviour that
 * matters is what a runner can finish *without*: no location, no city, no
 * unit change. One question.
 */
const DEFAULTS = { temp: "f", distance: "mi" } as const;

const FOUND: CityLookup = { kind: "found", lat: 44.98, lng: -93.27 };

function renderForm(
  overrides: {
    locate?: () => Promise<{ lat: number; lng: number } | undefined>;
    lookUpCity?: (input: { data: { label: string } }) => Promise<CityLookup>;
    defaults?: { temp: "f" | "c"; distance: "mi" | "km" };
  } = {},
) {
  // Typed and echoing its input, so `mock.calls[0]` has a shape.
  const save = vi.fn((input: { data: Calibration }) => Promise.resolve(input));
  const onSaved = vi.fn();
  const lookUpCity = vi.fn(
    overrides.lookUpCity ??
      ((): Promise<CityLookup> => Promise.resolve({ kind: "unavailable" })),
  );
  render(
    <CalibrateForm
      defaults={overrides.defaults ?? DEFAULTS}
      locate={overrides.locate ?? (() => Promise.resolve(undefined))}
      lookUpCity={lookUpCity}
      saveCalibration={save}
      onSaved={onSaved}
    />,
  );
  return { save, onSaved, lookUpCity, user: userEvent.setup() };
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

  it("names each field in the summary by the words on the screen", async () => {
    const { user, save } = renderForm();

    await user.click(screen.getByLabelText("Where you run"));
    await user.paste("x".repeat(121));
    await user.click(submit());

    expect(save).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", {
        name: "Warm or cold — Pick the one that sounds most like you.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Where you run — / }),
    ).toBeVisible();
  });

  it("keeps the submit in the page rather than letting the browser post it", () => {
    renderForm();
    const form = submit().closest("form");
    if (form === null) throw new Error("the submit is not inside a form");
    // `dispatchEvent` answers false when a handler cancelled the default.
    expect(fireEvent.submit(form)).toBe(false);
  });
});

describe("where you run: typed, resolved on submit (owner, 2026-09-24)", () => {
  it("explains the field, and offers no list of any kind", () => {
    renderForm();
    expect(
      screen.getByText(
        "Sets your climate cohort — runners who face the same winters.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("never asks while typing — only once, on submit", async () => {
    const { user, lookUpCity } = renderForm();

    await user.type(screen.getByLabelText("Where you run"), "Minneapolis");
    expect(lookUpCity).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());
    expect(lookUpCity).toHaveBeenCalledTimes(1);
    expect(lookUpCity).toHaveBeenCalledWith({
      data: { label: "Minneapolis" },
    });
  });

  it("saves a found city with its coordinates, and shows it as the chip", async () => {
    const answer = Promise.withResolvers<unknown>();
    const save = vi.fn<(input: { data: Calibration }) => Promise<unknown>>(
      () => answer.promise,
    );
    const lookUpCity = vi.fn(() => Promise.resolve(FOUND));
    const user = userEvent.setup();
    render(
      <CalibrateForm
        defaults={DEFAULTS}
        locate={() => Promise.resolve(undefined)}
        lookUpCity={lookUpCity}
        saveCalibration={save}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Where you run"), "  Minneapolis ");
    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: "Minneapolis", lat: 44.98, lng: -93.27 },
    });
    // The label asked about is the trimmed one the schema parsed.
    expect(lookUpCity).toHaveBeenCalledWith({
      data: { label: "Minneapolis" },
    });
    const chip = document.querySelector("[data-part='city-chip']");
    expect(chip).toHaveTextContent("Minneapolis");
    expect(screen.queryByLabelText("Where you run")).toBeNull();

    await act(async () => {
      answer.resolve({});
      await answer.promise;
    });
  });

  it("puts a place it cannot find on the field, in the field's words, and saves nothing", async () => {
    const { user, save } = renderForm({
      lookUpCity: () => Promise.resolve({ kind: "not-found" }),
    });

    await user.type(screen.getByLabelText("Where you run"), "Nowhereville");
    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());

    expect(
      await screen.findByText(
        "We couldn't find that place. Check the spelling.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Where you run")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Where you run")).toHaveFocus();
    });
    expect(save).not.toHaveBeenCalled();
    expect(document.querySelector("[data-part='failure-band']")).toBeNull();
  });

  it("saves the label alone when the lookup cannot answer", async () => {
    const { user, save } = renderForm({
      lookUpCity: () => Promise.resolve({ kind: "unavailable" }),
    });

    await user.type(screen.getByLabelText("Where you run"), "Seattle, WA");
    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: "Seattle, WA", lat: undefined, lng: undefined },
    });
    expect(document.querySelector("[data-part='city-chip']")).toBeNull();
  });

  it("sends no city, and asks nothing, for a field of spaces", async () => {
    const { user, save, lookUpCity } = renderForm();

    await user.click(screen.getByLabelText(/^About average/u));
    await user.type(screen.getByLabelText("Where you run"), " ".repeat(3));
    await user.click(submit());

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: undefined },
    });
    expect(lookUpCity).not.toHaveBeenCalled();
  });

  it("does not ask again for a place already resolved", async () => {
    const save = vi
      .fn<(input: { data: Calibration }) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("D1 down"))
      .mockResolvedValueOnce({});
    const lookUpCity = vi.fn(() => Promise.resolve(FOUND));
    const user = userEvent.setup();
    render(
      <CalibrateForm
        defaults={DEFAULTS}
        locate={() => Promise.resolve(undefined)}
        lookUpCity={lookUpCity}
        saveCalibration={save}
        onSaved={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText("Where you run"), "Minneapolis");
    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());
    await screen.findByRole("button", { name: "Try again" });

    await user.click(submit());

    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(lookUpCity).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      data: { cityLabel: "Minneapolis", lat: 44.98, lng: -93.27 },
    });
  });

  it("sends the located place, not the text left in the field under the chip", async () => {
    const { user, save, lookUpCity } = renderForm({
      locate: () => Promise.resolve({ lat: 1, lng: 2 }),
    });
    await user.type(screen.getByLabelText("Where you run"), "Mi");
    await user.click(locateButton());
    await waitFor(() => {
      expect(document.querySelector("[data-part='city-chip']")).not.toBeNull();
    });

    await user.click(screen.getByLabelText(/^About average/u));
    await user.click(submit());

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: undefined, lat: 1, lng: 2 },
    });
    expect(lookUpCity).not.toHaveBeenCalled();
  });

  it("puts the field back, with what was typed, when the chip is changed", async () => {
    const { user } = renderForm({
      locate: () => Promise.resolve({ lat: 1, lng: 2 }),
    });
    await user.type(screen.getByLabelText("Where you run"), "Mi");
    await user.click(locateButton());
    await waitFor(() => {
      expect(document.querySelector("[data-part='city-chip']")).not.toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Change" }));

    expect(screen.getByLabelText("Where you run")).toHaveValue("Mi");
    expect(document.querySelector("[data-part='city-chip']")).toBeNull();
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

  it("clears the denied line as soon as it is asked again", async () => {
    const second = Promise.withResolvers<undefined>();
    const answers = [Promise.resolve(undefined), second.promise];
    const { user } = renderForm({
      locate: () => answers.shift() ?? Promise.resolve(undefined),
    });
    await user.click(locateButton());
    await screen.findByText("Location’s off. Type your city instead.");

    await user.click(locateButton());

    // Gone while the second ask is still out — not only once it lands.
    expect(locateButton()).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText("Location’s off. Type your city instead."),
    ).toBeNull();

    await act(async () => {
      second.resolve(undefined);
      await second.promise;
    });
  });

  it("stops breathing and says so when the browser cannot even ask", async () => {
    // No geolocation at all throws rather than resolving to nothing.
    const { user } = renderForm({
      locate: () => Promise.reject(new TypeError("no geolocation")),
    });

    await user.click(locateButton());

    expect(
      await screen.findByText("Location’s off. Type your city instead."),
    ).toBeVisible();
    expect(locateButton()).not.toHaveAttribute("aria-busy");
    await waitFor(() => {
      expect(screen.getByLabelText("Where you run")).toHaveFocus();
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
