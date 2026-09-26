import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Garment } from "../../src/lib/contracts";
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
  photo: {
    upload: () => Promise.resolve({ ok: true as const }),
    remove: () => Promise.resolve(),
  },
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
    render(
      <GarmentForm
        {...formProps}
        photo={{ ...formProps.photo, url: "/closet/photo/01ITEM/card" }}
      />,
    );
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

describe("the shade sheet, wired into the form", () => {
  it("shows the chosen hex on the affordance, so level 2 is legible from level 1", async () => {
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));

    // Before: the affordance names itself and nothing else.
    expect(screen.getByRole("button", { name: "Exact shade" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    await user.type(screen.getByLabelText("Hex"), "#1f2a44");
    await user.click(screen.getByRole("button", { name: "Use this" }));

    // After: it carries the value, so the runner can see it without
    // reopening the sheet.
    expect(
      screen.getByRole("button", { name: "Exact shade · #1f2a44" }),
    ).toBeVisible();
  });

  it("gives the hex back when it is cleared", async () => {
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    await user.type(screen.getByLabelText("Hex"), "#1f2a44");
    await user.click(screen.getByRole("button", { name: "Use this" }));

    await user.click(
      screen.getByRole("button", { name: "Exact shade · #1f2a44" }),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("button", { name: "Exact shade" })).toBeVisible();
  });

  it("closes without keeping a half-typed hex, and opens again after", async () => {
    // Escape closes the dialog natively, so the form has to hear about it
    // — otherwise its own `shadeOpen` stays true, the effect's dependency
    // never changes, and the sheet cannot be reopened at all. Reopening is
    // the only thing that tells the two apart.
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    await user.type(screen.getByLabelText("Hex"), "#1f2");

    // `dialog.close()` is what Escape does in a browser; happy-dom does
    // not wire the key, so the close is driven directly. Either way the
    // `close` event is what `Sheet` reports through `onClose`.
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    act(() => {
      dialog?.close();
    });

    expect(dialog?.open).toBe(false);
    expect(screen.getByRole("button", { name: "Exact shade" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    expect(dialog?.open).toBe(true);
  });

  it("names the three visibility chips in the artboard's own words", () => {
    render(<GarmentForm {...formProps} />);
    for (const label of ["Plain", "Reflective trim", "Hi-viz"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("labels the two colour fields apart", () => {
    // Two fields on one form both saying "Color" is the collision the
    // colourway rename exists to avoid.
    render(<GarmentForm {...formProps} />);
    expect(screen.getByLabelText("Colorway")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Color" })).toBeInTheDocument();
  });

  it("sends the colour through to the save, lowercased", async () => {
    const save = vi.fn(() => Promise.resolve({ id: "01ITEM" }));
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} save={save} />);

    await user.type(screen.getByLabelText("Model / name"), "Norvan Shell");
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("radio", { name: "Hi-viz" }));
    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    await user.type(screen.getByLabelText("Hex"), "#1F2A44");
    await user.click(screen.getByRole("button", { name: "Use this" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        colorName: "navy",
        colorHex: "#1f2a44",
        visibilityLevel: "hi_viz",
      }),
    );
  });

  it("sends nothing for a colour the runner never answered", async () => {
    // "" is not an answer, and a strictObject rejects it — the absent
    // field has to be absent rather than empty.
    // Captured through a typed closure rather than a bare `vi.fn()`,
    // whose `mock.calls` would be `[][]` — an empty tuple has no element
    // to read, and the alternative is a cast.
    let sent: Garment | undefined;
    const save = (garment: Garment) => {
      sent = garment;
      return Promise.resolve({ id: "01ITEM" });
    };
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} save={save} />);

    await user.type(screen.getByLabelText("Model / name"), "Harrier");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(sent).toBeDefined();
    // Key *absence*, not an undefined value: `garmentSchema` is a
    // strictObject and an explicit `colorName: undefined` is a different
    // object from one without the key.
    for (const key of ["colorName", "colorHex", "visibilityLevel"]) {
      expect(Object.hasOwn(sent ?? {}, key)).toBe(false);
    }
  });
});

describe("the hex regex, at its edges", () => {
  it("wants exactly six digits — not five, not seven", () => {
    expect(colorHexSchema.safeParse("#1f2a4").success).toBe(false);
    expect(colorHexSchema.safeParse("#1f2a445").success).toBe(false);
  });

  it("is anchored at both ends", () => {
    // Unanchored, "the colour is #1f2a44 ok?" would store as a colour.
    expect(colorHexSchema.safeParse("x#1f2a44").success).toBe(false);
    expect(colorHexSchema.safeParse("#1f2a44x").success).toBe(false);
  });

  it("rejects hex digits it does not recognise", () => {
    expect(colorHexSchema.safeParse("#1f2g44").success).toBe(false);
  });
});

describe("the visibility values", () => {
  it("is exactly the three the artboard draws", () => {
    expect(garmentVisibilitySchema.options).toEqual([
      "plain",
      "reflective",
      "hi_viz",
    ]);
  });
});

describe("the form remembers what was already chosen", () => {
  it("starts with the sheet shut", async () => {
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));

    // A sheet that opens itself is a modal nobody asked for, over a form
    // the runner is still filling in. Asserted on the dialog's own `open`
    // state, because a `<dialog>` renders its children either way — what
    // changes is whether they are shown.
    expect(document.querySelector("dialog")?.open).toBe(false);
  });

  it("closes the sheet once a shade is used", async () => {
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    await user.type(screen.getByLabelText("Hex"), "#1f2a44");
    await user.click(screen.getByRole("button", { name: "Use this" }));

    expect(document.querySelector("dialog")?.open).toBe(false);
  });

  it("closes the sheet once a shade is cleared", async () => {
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} />);
    await user.click(screen.getByRole("radio", { name: "Navy" }));
    await user.click(screen.getByRole("button", { name: "Exact shade" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(document.querySelector("dialog")?.open).toBe(false);
  });

  it("checks the colour the garment already carries", () => {
    // An edit starts from what is stored, and a chip that does not show
    // the stored choice invites the runner to re-answer a question they
    // have already answered.
    render(
      <GarmentForm
        {...formProps}
        initial={{ colorName: "green", visibilityLevel: "reflective" }}
      />,
    );

    expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Reflective trim" }),
    ).toBeChecked();
  });

  it("checks nothing when the garment carries no colour", () => {
    render(<GarmentForm {...formProps} />);

    for (const label of ["Green", "Navy", "Plain", "Hi-viz"]) {
      expect(screen.getByRole("radio", { name: label })).not.toBeChecked();
    }
  });

  it("names both chip groups, which is what the error summary reads back", () => {
    render(<GarmentForm {...formProps} />);
    expect(screen.getByRole("group", { name: "Visibility" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Color" })).toBeVisible();
  });

  it("calls a bad stored hex by its name when the save fails", async () => {
    // `colorHex` has no field of its own on this form — it lives in the
    // sheet — so the summary is the only place its label is ever read. A
    // blank label there is a row pointing at nothing.
    const user = userEvent.setup();
    render(<GarmentForm {...formProps} initial={{ colorHex: "nope" }} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(/Hex — Use a six-digit hex like #1f2a44\./),
    ).toBeVisible();
  });
});
