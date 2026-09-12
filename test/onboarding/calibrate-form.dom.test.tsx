import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CalibrateForm } from "../../src/modules/onboarding/components/CalibrateForm";
import type { Calibration } from "../../src/modules/onboarding/inputs";

/**
 * Screen O1. The behaviour that matters is what a runner can finish
 * *without*: no location, no typed city, no unit change. One question.
 */
const DEFAULTS = { temp: "f", distance: "mi" } as const;

function renderForm(
  overrides: {
    locate?: () => Promise<{ lat: number; lng: number } | undefined>;
    onSaved?: () => void;
  } = {},
) {
  // Typed and echoing its input, so `mock.calls[0]` has a shape.
  const save = vi.fn((input: { data: Calibration }) => Promise.resolve(input));
  render(
    <CalibrateForm
      defaults={DEFAULTS}
      locate={overrides.locate ?? (() => Promise.resolve(undefined))}
      saveCalibration={save}
      onSaved={overrides.onSaved ?? vi.fn()}
    />,
  );
  return save;
}

describe("CalibrateForm", () => {
  it("asks the design's question, with its five answers", () => {
    renderForm();

    expect(
      screen.getByRole("group", {
        name: "Compared to people you run with, do you run warm or cold?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Always freezing/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/^Sweating in a t-shirt at 40°/),
    ).toBeInTheDocument();
  });

  it("shows the offset, because design says it is visible on purpose", () => {
    // Requirement 1 names this copy. The numbers are the artboard's:
    // +8°/+4°/0°/−4°/−8° in Fahrenheit, from 2.2°C per step.
    renderForm();

    // A tuple array, so both halves are typed and neither needs a non-null
    // assertion to destructure. The minus is U+2212, which is what the
    // component renders: a hyphen sits at the wrong height in mono.
    const offsets: readonly (readonly [string, string])[] = [
      ["Always freezing", "+8\u{00B0}"],
      ["Run a little cold", "+4\u{00B0}"],
      ["About average", "0\u{00B0}"],
      ["Run a little warm", "\u{2212}4\u{00B0}"],
      ["Sweating in a t-shirt at 40°", "\u{2212}8\u{00B0}"],
    ];
    for (const [answer, offset] of offsets) {
      expect(
        screen.getByLabelText(new RegExp(`^${answer}`)).closest("label"),
      ).toHaveTextContent(offset);
    }
    expect(
      screen.getByText(
        "The offset is visible on purpose. You'll see it change as we learn.",
      ),
    ).toBeVisible();
  });

  it("moves the offsets when the unit changes", () => {
    // A temperature *difference*: Fahrenheit is ×9/5, never +32. Getting
    // that wrong turns +8° into +40°, which is wrong and not obviously so.
    renderForm();

    const alwaysFreezing = () =>
      screen.getByLabelText(/^Always freezing/).closest("label");
    expect(alwaysFreezing()).toHaveTextContent("+8°");

    fireEvent.change(screen.getByLabelText("Temperature"), {
      target: { value: "c" },
    });

    expect(alwaysFreezing()).toHaveTextContent("+4°");
  });

  it("keeps a unit on the offsets when the select is cleared", () => {
    // `ChoiceField` carries an empty option, so "" is a state a person can
    // reach. The offsets are the screen's promise that the answer means
    // something measurable; they cannot lose their unit halfway.
    renderForm();
    expect(
      screen.getByLabelText(/^Always freezing/).closest("label"),
    ).toHaveTextContent("+8°");

    fireEvent.change(screen.getByLabelText("Temperature"), {
      target: { value: "" },
    });

    expect(
      screen.getByLabelText(/^Always freezing/).closest("label"),
    ).toHaveTextContent("+8°");
  });

  it("finishes on the one required answer", async () => {
    // The two-tap target: pick an answer, submit. No city, no location, no
    // unit change.
    const user = userEvent.setup();
    const save = renderForm();

    await user.click(screen.getByLabelText(/^Always freezing/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

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
  });

  it("writes the negative end of the scale as a negative number", async () => {
    // Positive means runs cold. A form that sent the option's index, or
    // dropped the sign, would calibrate every warm runner backwards.
    const user = userEvent.setup();
    const save = renderForm();

    await user.click(screen.getByLabelText(/^Sweating in a t-shirt at 40°/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { thermalLevel: -2 },
    });
  });

  it("refuses to submit with no answer, and says so in the schema's words", async () => {
    const user = userEvent.setup();
    const save = renderForm();

    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save).not.toHaveBeenCalled();
    // Under the field, not in the summary: the contract's summary appears
    // only once two or more fields fail at once. And in the schema's own
    // sentence — without one, `Number(undefined)` gets a runner "expected
    // number, received nan".
    expect(
      await screen.findByText("Pick the one that sounds most like you."),
    ).toBeVisible();
  });

  it("carries a typed city, trimmed", async () => {
    const user = userEvent.setup();
    const save = renderForm();

    await user.click(screen.getByLabelText(/^About average/));
    await user.type(screen.getByLabelText("Where you run"), "  Seattle, WA  ");
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { cityLabel: "Seattle, WA" },
    });
  });

  it("carries coordinates once the browser gives them", async () => {
    const user = userEvent.setup();
    const save = renderForm({
      locate: () => Promise.resolve({ lat: 44.98, lng: -93.27 }),
    });

    await user.click(screen.getByRole("button", { name: "Use my location" }));
    expect(await screen.findByText("Got it.")).toBeVisible();

    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { lat: 44.98, lng: -93.27 },
    });
  });

  it("treats a refused permission as an answer, not a failure", async () => {
    // Requirement 1: denial must not block. It says so plainly and leaves
    // the typed-city path intact — no failure band, no blocked submit.
    const user = userEvent.setup();
    const save = renderForm({ locate: () => Promise.resolve(undefined) });

    await user.click(screen.getByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText("No location — the city above is enough."),
    ).toBeVisible();
    expect(screen.queryByText(/didn't work|try again/i)).toBeNull();

    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("says nothing about location before it has been asked", () => {
    renderForm();

    expect(screen.queryByText("Got it.")).toBeNull();
    expect(screen.queryByText(/No location/)).toBeNull();
  });

  it("names the units in words, not in codes", () => {
    // "f" and "mi" are what the contract stores; nobody picks a unit from
    // a two-letter code.
    renderForm();

    expect(screen.getByLabelText("Temperature")).toHaveTextContent("Fahrenheit");
    expect(screen.getByLabelText("Temperature")).toHaveTextContent("Celsius");
    expect(screen.getByLabelText("Distance")).toHaveTextContent("Miles");
    expect(screen.getByLabelText("Distance")).toHaveTextContent("Kilometres");
  });

  it("offers the units, defaulted from the locale and editable", async () => {
    const user = userEvent.setup();
    const save = renderForm();

    await user.selectOptions(screen.getByLabelText("Temperature"), "c");
    await user.selectOptions(screen.getByLabelText("Distance"), "km");
    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { tempUnit: "c", distanceUnit: "km" },
    });
  });

  it("lists both failures by name when two fields fail at once", async () => {
    // The contract's summary appears only from two errors up, so this is
    // the one path that renders the field labels at all.
    const user = userEvent.setup();
    const save = renderForm();

    await user.type(screen.getByLabelText("Where you run"), " ".repeat(3));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    // The summary is a focusable container, not a live region — the
    // contract announces it by moving focus to it. So it is found by its
    // own words, and each row is a button that focuses its field.
    expect(await screen.findByText("Nothing saved")).toBeVisible();
    // "2 fields need a fix." appears twice on purpose — once in the live
    // region that announces the outcome and once in the summary that lists
    // it — so it is not a useful anchor. The rows are.
    expect(
      screen.getByRole("button", { name: /^Warm or cold —/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Where you run —/ }),
    ).toBeVisible();
    expect(save).not.toHaveBeenCalled();
  });

  it("sends no unit at all when the runner clears one", async () => {
    // The em-dash option means "not saying", and it has to reach the
    // server as absent rather than as an empty string the column rejects.
    const user = userEvent.setup();
    const save = renderForm();

    await user.selectOptions(screen.getByLabelText("Temperature"), "");
    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { tempUnit: undefined, distanceUnit: "mi" },
    });
  });

  it("clears the distance unit independently of the temperature one", async () => {
    // Both units carry their own "not saying" branch, and a test that only
    // ever clears one leaves the other's unexercised.
    const user = userEvent.setup();
    const save = renderForm();

    await user.selectOptions(screen.getByLabelText("Distance"), "");
    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      data: { tempUnit: "f", distanceUnit: undefined },
    });
  });

  it("says it saved, in the one live region", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(await screen.findByText("Calibrated.")).toBeVisible();
  });

  it("never lets the browser submit the form itself", async () => {
    // `noValidate` plus `preventDefault`: without the second the page
    // navigates away mid-submit and the handler's result is lost.
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText(/^About average/));

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Start running" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    expect(prevented).toBe(true);
  });

  it("sends no city when the runner typed none", async () => {
    // Absent, not an empty string — the column is nullable and "" is not
    // a place.
    const user = userEvent.setup();
    const save = renderForm();

    await user.click(screen.getByLabelText(/^About average/));
    await user.click(screen.getByRole("button", { name: "Start running" }));

    expect(save.mock.calls[0]?.[0].data.cityLabel).toBeUndefined();
  });

  it("never disables the submit button", async () => {
    // §5 of the Forms contract: `disabled` drops focus and stops
    // announcing. The double-submit guard lives in the handler.
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByLabelText(/^About average/));

    const submit = screen.getByRole("button", { name: "Start running" });
    await user.click(submit);

    expect(submit).not.toBeDisabled();
  });
});
