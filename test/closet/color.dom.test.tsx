import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  chromaticColorNames,
  colorClass,
  colorHexSchema,
  colorNameSchema,
  garmentVisibilitySchema,
  neutralColorNames,
} from "../../src/lib/contracts";
import { GarmentForm } from "../../src/modules/closet/components/GarmentForm";

const formProps = {
  save: vi.fn(() => Promise.resolve({ id: "01ITEM" })),
  onSaved: () => Promise.resolve(),
  submitLabel: "Save",
  pendingLabel: "Saving",
  successMessage: "Saved.",
};

describe("the thirteen names (design round 11 §AH)", () => {
  it("is exactly thirteen, in two classes, with no multi and no other", () => {
    // Rule 01, and the list is locked. A fourteenth entry is a product
    // decision, not a lane's.
    expect(colorNameSchema.options).toHaveLength(13);
    expect(neutralColorNames).toHaveLength(6);
    expect(chromaticColorNames).toHaveLength(7);
    expect(colorNameSchema.options).not.toContain("multi");
    expect(colorNameSchema.options).not.toContain("other");
  });

  it("does not carry hi-viz as a fourteenth name", () => {
    // "It isn't a colour, it's a reason, and the VISIBILITY attribute
    // already holds it." Rule 04 makes a hi-viz garment invisible to the
    // test entirely — not Neutral, not Colour, not counted — which is only
    // expressible while the two live in different fields.
    expect(colorNameSchema.options).not.toContain("hi_viz");
    expect(garmentVisibilitySchema.options).toContain("hi_viz");
  });

  it("derives the class from the two lists rather than a third copy", () => {
    for (const name of neutralColorNames)
      expect(colorClass(name)).toBe("neutral");
    for (const name of chromaticColorNames) {
      expect(colorClass(name)).toBe("chromatic");
    }
    // Every name lands in exactly one class — no name is missing and none
    // is in both, which a hand-written third list is free to get wrong.
    // Compared as sets, because the two classes are ordered by class and
    // the enum by concatenation; what is being asserted is membership.
    expect(new Set([...neutralColorNames, ...chromaticColorNames])).toEqual(
      new Set(colorNameSchema.options),
    );
    expect(neutralColorNames.length + chromaticColorNames.length).toBe(
      colorNameSchema.options.length,
    );
  });
});

describe("the hex field", () => {
  it("takes a six-digit lowercase hex and nothing else", () => {
    expect(colorHexSchema.safeParse("#1f2a44").success).toBe(true);
    // Shorthand is rejected rather than expanded: the field is filled by
    // sampling a photo or pasting what a brand published, and neither
    // produces `#abc`.
    expect(colorHexSchema.safeParse("#abc").success).toBe(false);
    expect(colorHexSchema.safeParse("1f2a44").success).toBe(false);
    expect(colorHexSchema.safeParse("#1F2A44").success).toBe(false);
  });

  it("says what to do when it is wrong, in the schema", () => {
    const result = colorHexSchema.safeParse("nope");
    expect(result.error?.issues[0]?.message).toBe(
      "Use a six-digit hex like #1f2a44.",
    );
  });
});

describe("colour on the garment form", () => {
  it("offers the names as words, never as swatches", () => {
    // "Thirteen swatches is thirteen accents in one viewport", and hue
    // means verdict everywhere else in this app. The chips carry no
    // background colour of their own beyond the ink/ground pair every
    // chosen chip uses.
    render(<GarmentForm {...formProps} />);

    const navy = screen.getByRole("radio", { name: "Navy" });
    expect(navy).toBeInTheDocument();
    const chip = navy.closest("label");
    expect(chip?.className).not.toMatch(/bg-(action|teal|failure|unread)/);
    expect(chip?.getAttribute("style")).toBeNull();
  });

  it("sits inside the attributes group, so the happy path does not grow", () => {
    // §AH: "colour is the fifth attribute, inside the group that's already
    // collapsed — F stays identity-first and the tap count on the happy
    // path doesn't move."
    render(<GarmentForm {...formProps} />);

    // The colour group is a `<fieldset>` of its own — that is what a radio
    // group is — so the question is whether it sits *inside* the
    // collapsed Attributes group rather than beside it.
    const attributes = screen.getByRole("group", { name: "Attributes" });
    expect(attributes).toContainElement(
      screen.getByRole("radio", { name: "Navy" }),
    );
    expect(attributes).toContainElement(
      screen.getByRole("radio", { name: "Hi-viz" }),
    );
    // And identity still leads: the name field is not in that group.
    expect(attributes).not.toContainElement(screen.getByLabelText("Colorway"));
  });

  it("keeps the exact-shade sheet unreachable until a name is chosen", async () => {
    // "Level 2 without level 1 isn't possible — the sheet is reached from
    // a chosen name." The affordance does not exist rather than existing
    // and refusing.
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);

    expect(screen.queryByRole("button", { name: /exact shade/i })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Navy" }));

    expect(
      screen.getByRole("button", { name: /exact shade/i }),
    ).toBeInTheDocument();
  });

  it("offers no sampler when the garment has no photo", async () => {
    // "No photo → no sampler, the field stands alone."
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("button", { name: /exact shade/i }));

    expect(screen.getByLabelText("Hex")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/paste what the brand published/i)).toBeVisible();
  });

  it("offers the photo as a sampler when there is one", async () => {
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} photoUrl="/closet/photo/01ITEM/card" />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("button", { name: /exact shade/i }));

    expect(
      screen.getByAltText(/tap to sample a shade from your photo/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/tap the photo to sample/i)).toBeVisible();
  });

  it("keeps the colourway the runner typed, beside the chosen name", async () => {
    // "The colourway the runner typed ('Obsidian') sits as the row's
    // caption, untouched." Nothing parses it into one of the thirteen —
    // that is the parser round 5 refused.
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);

    await user.type(screen.getByLabelText("Colorway"), "Obsidian");
    await user.click(screen.getByRole("radio", { name: "Black" }));

    expect(screen.getByLabelText("Colorway")).toHaveValue("Obsidian");
    expect(screen.getByRole("radio", { name: "Black" })).toBeChecked();
  });
});
