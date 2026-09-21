import { render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { violations } from "./axe";
import { Bracketed } from "../../src/ui/Bracketed";
import {
  ChoiceList,
  FormErrorSummary,
  FormFailureBand,
  FormField,
  FormStatus,
  SubmitButton,
  TextField,
  ToggleField,
} from "../../src/ui/form";
import { Icon } from "../../src/ui/icons";
import { CoverageMark, VerdictMark } from "../../src/ui/Marks";
import { Mono } from "../../src/ui/Mono";
import { ProductLink } from "../../src/ui/ProductLink";
import { Skeleton } from "../../src/ui/Skeleton";
import type { FieldProps } from "../../src/ui/use-form-submit";

/**
 * The mechanical half of the contract, over `src/ui/`.
 *
 * Every primitive here is rendered in the states a screen can put it in,
 * because axe reads the DOM in front of it and a component's resting state
 * is the one least likely to be wrong: `FormField` is fine until it is
 * invalid and grows a message nothing points at, `SubmitButton` is fine
 * until it is pending and carries `aria-busy` on an element that may not
 * take it.
 *
 * The module components are covered from their own suites — they need
 * fixtures, and their fixtures already live there.
 */
const field = (name: string): FieldProps => ({
  name,
  readOnly: false,
  "aria-invalid": undefined,
  "aria-describedby": undefined,
  onInput: () => {
    // Nothing to clear.
  },
});

const invalidField = (name: string): FieldProps => ({
  ...field(name),
  "aria-invalid": true,
  "aria-describedby": `${name}-message`,
});

/**
 * `FormErrorSummary` takes a live ref, not a literal — `useRef(null)` is
 * how every real caller gets one, so the fixture renders the summary from
 * inside a component instead of building a fake `{ current: null }` object
 * (which is also the one shape `unicorn/no-null` cannot see through: it
 * exempts `useRef(null)` by name, nothing else).
 */
function FormErrorSummaryCase() {
  const summaryRef = useRef<HTMLDivElement>(null);
  return (
    <FormErrorSummary
      rows={[
        { name: "a", label: "Brand", message: "Required." },
        { name: "b", label: "Name", message: "Required." },
      ]}
      onFocusField={() => {
        // Nothing to focus in this fixture.
      }}
      summaryRef={summaryRef}
    />
  );
}

describe("axe · src/ui primitives", () => {
  it.each([
    ["Mono", <Mono>4:52</Mono>],
    ["Bracketed", <Bracketed>8 of 9</Bracketed>],
    ["Skeleton", <Skeleton className="h-4 w-24" />],
    ["Icon, decorative", <Icon name="bell" />],
    ["Icon, named", <Icon name="bell" label="Notifications" />],
    ["CoverageMark", <CoverageMark level="partial" />],
    ["VerdictMark", <VerdictMark kind="dialed" />],
    [
      "ProductLink",
      <ProductLink url="https://example.com/x" label="Merino base" />,
    ],
    ["FormStatus", <FormStatus>Run logged.</FormStatus>],
    [
      "TextField",
      <TextField
        name="brand"
        label="Brand"
        value=""
        onChange={() => {
          // Nothing to update in this fixture.
        }}
        field={field}
      />,
    ],
    [
      "TextField, invalid",
      <TextField
        name="brand"
        label="Brand"
        value=""
        onChange={() => {
          // Nothing to update in this fixture.
        }}
        field={invalidField}
        error="Pick a brand from the list."
      />,
    ],
    [
      "FormField with a hint",
      <FormField name="x" label="Label" hint="One sentence.">
        <input id="x" name="x" />
      </FormField>,
    ],
    [
      "ToggleField",
      <ToggleField
        name="indoor"
        label="Indoor / treadmill"
        field={field}
        isOn={false}
        onChange={() => {
          // Nothing to update in this fixture.
        }}
      />,
    ],
    [
      "ChoiceList, rows",
      <ChoiceList
        name="level"
        legend="How do you run warm?"
        options={["cold", "warm"] as const}
        optionLabels={{ cold: "Always freezing", warm: "Always roasting" }}
        value="cold"
        field={field}
        onChange={() => {
          // Nothing to update in this fixture.
        }}
      />,
    ],
    [
      "ChoiceList, chips, invalid",
      <ChoiceList
        name="colour"
        legend="Colour"
        layout="chips"
        options={["red", "blue"] as const}
        optionLabels={{ red: "Red", blue: "Blue" }}
        value=""
        field={invalidField}
        error="Pick one."
        onChange={() => {
          // Nothing to update in this fixture.
        }}
      />,
    ],
    [
      "SubmitButton",
      <SubmitButton label="Save" pendingLabel="Saving" pending={false} />,
    ],
    [
      "SubmitButton, pending",
      <SubmitButton label="Save" pendingLabel="Saving" pending />,
    ],
    [
      "FormFailureBand",
      <FormFailureBand
        failure={{
          kind: "server",
          message: "Our end failed. Nothing changed.",
        }}
        onRetry={() => {
          // Nothing to retry in this fixture.
        }}
      />,
    ],
    ["FormErrorSummary", <FormErrorSummaryCase />],
  ])("%s has no WCAG 2.2 AA violations", async (_name, element) => {
    const { container } = render(element);
    await expect(violations(container)).resolves.toEqual([]);
  });

  it("would report a violation, so the cases above are not vacuous", async () => {
    // Every case says "no violations", which an axe that ran nothing would
    // also say. This is the control: a button with no accessible name is
    // the exact failure the suite exists to catch.
    const { container } = render(
      <button type="button">
        <span aria-hidden="true">×</span>
      </button>,
    );
    await expect(violations(container)).resolves.toEqual([
      { id: "button-name", nodes: [expect.any(String)] },
    ]);
  });
});
