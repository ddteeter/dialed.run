import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GarmentForm } from "../../src/modules/closet/components/GarmentForm";
import type { GarmentFormProps } from "../../src/modules/closet/components/GarmentForm";
import { garmentCategoriesInOrder } from "../../src/lib/garment-fields";

/**
 * Screen F, driven.
 *
 * The form's whole subject is which fields a category admits, and that is
 * derived from `garmentSchema` rather than restated — so the assertion
 * worth making is that the rendered form and the schema agree, for every
 * category, rather than that one arrangement produces some markup.
 *
 * **What `save` receives is a parsed `Garment`, not the form's state.**
 * That is the D-17 change: the form runs `garmentFormSchema`, which
 * reshapes and validates before anything is called, so a blank text field
 * arrives absent rather than as `""` and an invalid one never arrives at
 * all. Before this the route did the parse, inside a `void`-ed handler,
 * and an invalid garment threw into an unhandled rejection — the button
 * silently did nothing.
 */

/**
The same dodge `test/lib/contracts-boundaries.test.ts` documents: a literal
`http://` in a test is autofixed to `https://` — `unicorn/prefer-https` and
`sonarjs/no-clear-text-protocols` both do it — which silently turns "this
insecure URL is rejected" into "this secure URL is rejected". Built from a
variable so no fixer can see it. Reported as guardrails#63.
*/
function urlWithScheme(scheme: string): string {
  return `${scheme}://example.com`;
}

function nothing() {
  // the save is not what is under test here
}

type SaveMock = ReturnType<typeof vi.fn<GarmentFormProps["save"]>>;

/**
A `<select>` by its label, narrowed rather than cast — the options are the
subject of two tests and `HTMLElement` does not have them.
*/
function selectFor(label: string): HTMLSelectElement {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLSelectElement)) {
    throw new TypeError(`${label} is not a select`);
  }
  return element;
}

function renderForm(overrides: Partial<GarmentFormProps> = {}) {
  const save: SaveMock = vi.fn(() => Promise.resolve({ id: "01ITEM" }));
  const props: GarmentFormProps = {
    save,
    // navigation is the route's, not the form's
    onSaved: () => Promise.resolve(),
    submitLabel: "Save",
    pendingLabel: "Saving",
    successMessage: "Saved.",
    ...overrides,
  };
  const view = render(<GarmentForm {...props} />);
  return {
    save: (overrides.save ?? save) as SaveMock,
    rerender: (next: Partial<GarmentFormProps>) => {
      view.rerender(<GarmentForm {...props} {...next} />);
    },
  };
}

async function saved(save: SaveMock) {
  await waitFor(() => {
    expect(save).toHaveBeenCalled();
  });
  return save.mock.calls[0]?.[0] as Record<string, unknown>;
}

/**
Every value a `<select>` offers, in order.
*/
function optionValues(label: string): string[] {
  return [...selectFor(label).options].map((option) => option.value);
}

function optionLabels(label: string): (string | null)[] {
  return [...selectFor(label).options].map((option) => option.textContent);
}

/**
The `name` attribute a control carries — the string `useFormSubmit` focuses
and marks by.
*/
function named(label: string | RegExp): string | null {
  return screen.getByLabelText(label).getAttribute("name");
}

function brandOptions(): string[] {
  const list = document.querySelector("#garment-brand-options");
  return [...(list?.querySelectorAll("option") ?? [])].map(
    (option) => option.value,
  );
}

describe("GarmentForm: identity leads", () => {
  it("saves with a category and a name alone — never blocked on a brand", async () => {
    // D-27: a generic entry is one submit away.
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "Long sleeve top");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const garment = await saved(save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(garment).toMatchObject({
      name: "Long sleeve top",
      category: "top",
    });
    // Absent, not empty: `garmentBase` is a strictObject over optionals,
    // so `""` would be a value the contract has to carry rather than a
    // brand nobody typed.
    expect(garment.brand).toBeUndefined();
  });

  it("offers every category, in the contract's order, with its label", () => {
    renderForm();

    const options = [...selectFor("Category").options];

    expect(options.map((option) => option.value)).toStrictEqual([
      ...garmentCategoriesInOrder,
    ]);
    // And the labels a person actually reads. A missing one renders as a
    // blank row in the picker, which no value assertion would catch.
    expect(options.map((option) => option.textContent)).toStrictEqual([
      "Top",
      "Bottom",
      "Headwear",
      "Neckwear",
      "Gloves",
      "Socks",
      "Shoes",
      "Accessory",
    ]);
  });

  it("starts every field empty, so nothing is a value the user did not choose", () => {
    // The blank start matters: a pre-selected weight is an invention that
    // reaches the database looking like an answer.
    renderForm();

    expect(screen.getByLabelText(/Brand/)).toHaveValue("");
    expect(screen.getByLabelText(/Model \/ name/)).toHaveValue("");
    expect(screen.getByLabelText("Size")).toHaveValue("");
    expect(screen.getByLabelText("Color")).toHaveValue("");
    expect(screen.getByLabelText("Product link")).toHaveValue("");
    expect(screen.getByLabelText("Layer")).toHaveValue("");
    expect(screen.getByLabelText("Weight")).toHaveValue("");
    expect(screen.getByLabelText("Fabric")).toHaveValue("");
    expect(screen.getByLabelText("Wind resistant")).not.toBeChecked();
    expect(screen.getByLabelText("Water resistant")).not.toBeChecked();
  });

  it("submits those blanks as absences, not as empty strings", async () => {
    // The rendered `<select>` cannot tell us this on its own: a value that
    // matches no option shows as the first option regardless, so an
    // initial value of nonsense looks identical to an initial value of "".
    // What the caller receives is the thing that matters — and after D-17
    // that is the parsed garment, where "not answered" is absence.
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "Tee");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // A top admits all five attributes; the three enums went unanswered
    // and the two booleans have a real answer, which is `false`.
    // `toEqual`, not `toStrictEqual`: zod keeps an optional key whose value
    // resolved to `undefined`, and "absent" versus "present and undefined"
    // is not a distinction this form is making.
    expect(await saved(save)).toEqual({
      name: "Tee",
      category: "top",
      windResistant: false,
      waterResistant: false,
    });
  });

  it("records the plain text fields a user types", async () => {
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "Harrier");
    await user.type(screen.getByLabelText("Size"), "M");
    await user.type(screen.getByLabelText("Color"), "Navy");
    await user.type(
      screen.getByLabelText("Product link"),
      "https://example.com/harrier",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await saved(save)).toMatchObject({
      name: "Harrier",
      size: "M",
      color: "Navy",
      productUrl: "https://example.com/harrier",
    });
  });

  it("submits through its own handler, never the browser's", async () => {
    const user = userEvent.setup();
    const { save } = renderForm();
    await user.type(screen.getByLabelText(/Model \/ name/), "Tee");

    let prevented: boolean | undefined;
    const watch = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    document.addEventListener("submit", watch);
    try {
      await user.click(screen.getByRole("button", { name: "Save" }));
    } finally {
      document.removeEventListener("submit", watch);
    }

    await saved(save);
    expect(prevented).toBe(true);
  });

  it("starts from the values it is given, and keeps the rest empty", () => {
    renderForm({
      initial: { brand: "Tracksmith", name: "Harrier", category: "shoes" },
      submitLabel: "Save changes",
    });

    expect(screen.getByLabelText(/Brand/)).toHaveValue("Tracksmith");
    expect(screen.getByLabelText(/Model \/ name/)).toHaveValue("Harrier");
    expect(screen.getByLabelText("Category")).toHaveValue("shoes");
    expect(screen.getByLabelText("Size")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
  });
});

describe("GarmentForm: the failure path D-17 was about", () => {
  it("gives every control its own field name", () => {
    // Not decoration: `useFormSubmit` focuses a failed field by
    // `[name="…"]`, and reads `aria-invalid`/`aria-describedby` out of a
    // map keyed by the same string. A control wired to the wrong name — or
    // to none — still renders, still submits, and silently stops being
    // markable or focusable when its own value is the one at fault.
    renderForm();

    expect(named(/Brand/)).toBe("brand");
    expect(named("Category")).toBe("category");
    expect(named("Layer")).toBe("layer");
    expect(named("Weight")).toBe("weight");
    expect(named("Fabric")).toBe("fabric");
    expect(named("Wind resistant")).toBe("windResistant");
    expect(named("Water resistant")).toBe("waterResistant");
    expect(named("Size")).toBe("size");
    expect(named("Color")).toBe("color");
    expect(named("Product link")).toBe("productUrl");
  });

  it("marks the product link and says why, instead of doing nothing", async () => {
    // The bug this replaces, exactly: `type="url"` accepts the scheme, the
    // schema does not, and the parse used to throw into a `void`-ed
    // handler — no message, no mark, a button that did nothing at all.
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "Harrier");
    await user.type(
      screen.getByLabelText("Product link"),
      urlWithScheme("http"),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Product links need to start with https://"),
    ).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Product link")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("announces one field failure in the words the contract fixes", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "x".repeat(81));
    await user.click(screen.getByRole("button", { name: "Save" }));

    // One sentence, on every outcome, into the one live region.
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nothing saved. One field needs a fix.",
    );
  });

  it("summarises once two fields fail at once", async () => {
    // By count, per the contract: 1 is a field message, 2+ is a summary
    // block as well.
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "Harrier");
    await user.type(screen.getByLabelText(/Brand/), "b".repeat(61));
    await user.type(screen.getByLabelText("Size"), "s".repeat(21));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nothing saved. 2 fields need a fix.",
    );
    // Each row focuses its field, and is a button — a form is not a
    // document.
    expect(
      screen.getByRole("button", { name: /Brand/ }),
    ).toBeVisible();
  });

  it("marks the button and no field when the save itself fails", async () => {
    // The distinction the contract exists to draw: nothing was saved and
    // the fix is *not* inside the form, so no field is marked.
    const user = userEvent.setup();
    const save: SaveMock = vi.fn(() =>
      Promise.reject(new Error("network")),
    );
    renderForm({ save });

    await user.type(screen.getByLabelText(/Model \/ name/), "Harrier");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The band's own sentence, not "Nothing saved" — that phrase is in the
    // live region too, so matching it finds both.
    expect(
      await screen.findByText("Our end failed. Nothing changed."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.getByLabelText(/Model \/ name/)).not.toHaveAttribute(
      "aria-invalid",
    );
    // The values are never cleared on a form failure.
    expect(screen.getByLabelText(/Model \/ name/)).toHaveValue("Harrier");
  });

  it("announces the success sentence too", async () => {
    const user = userEvent.setup();
    renderForm({ successMessage: "Added to your closet." });

    await user.type(screen.getByLabelText(/Model \/ name/), "Harrier");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Added to your closet.",
    );
  });
});

describe("GarmentForm: the brand suggestions", () => {
  it("reports what is typed so the caller can fetch matches", async () => {
    const user = userEvent.setup();
    const onBrandInput = vi.fn();
    renderForm({ onBrandInput });

    await user.type(screen.getByLabelText(/Brand/), "Tra");

    expect(onBrandInput).toHaveBeenLastCalledWith("Tra");
  });

  it("offers the caller's options, and renders an empty list without one", () => {
    const { rerender } = renderForm({
      brandOptions: ["Tracksmith", "Nike"],
    });
    expect(brandOptions()).toStrictEqual(["Tracksmith", "Nike"]);

    // `?? []`: no options is a datalist with nothing in it, not a crash.
    rerender({ brandOptions: undefined });
    expect(brandOptions()).toStrictEqual([]);
  });

  it("takes a brand happily with nobody listening", async () => {
    // `onBrandInput?.()` — the prop is optional, and the edit screen does
    // not pass one. Without the optional call this throws on the first
    // keystroke.
    const user = userEvent.setup();
    // An exception thrown inside an event handler surfaces as an uncaught
    // error rather than failing the assertion that follows it, so it has
    // to be listened for. Without the optional call this throws on every
    // keystroke and the form still looks like it works.
    const raised: string[] = [];
    const watch = (event: ErrorEvent) => {
      raised.push(event.message);
    };
    globalThis.addEventListener("error", watch);
    let save: ReturnType<typeof renderForm>["save"];
    try {
      save = renderForm().save;
      await user.type(screen.getByLabelText(/Brand/), "Nike");
      await user.type(screen.getByLabelText(/Model \/ name/), "Pegasus");
      await user.click(screen.getByRole("button", { name: "Save" }));
    } finally {
      globalThis.removeEventListener("error", watch);
    }

    expect(raised).toStrictEqual([]);
    expect(await saved(save)).toMatchObject({ brand: "Nike" });
  });

  it("still records the brand it was given while suggesting", async () => {
    // Both halves of the change handler: the field updates *and* the
    // caller hears about it. Dropping either leaves the other looking fine.
    const user = userEvent.setup();
    const { save } = renderForm({ onBrandInput: nothing });

    await user.type(screen.getByLabelText(/Brand/), "Nike");
    await user.type(screen.getByLabelText(/Model \/ name/), "Pegasus");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await saved(save)).toMatchObject({ brand: "Nike" });
  });
});

describe("GarmentForm: the attributes a category admits", () => {
  const ATTRIBUTE_LABELS = [
    "Layer",
    "Weight",
    "Fabric",
    "Wind resistant",
    "Water resistant",
  ] as const;

  it.each([
    ["top", ["Layer", "Weight", "Fabric", "Wind resistant", "Water resistant"]],
    ["socks", ["Weight", "Fabric"]],
    ["shoes", ["Water resistant"]],
    ["accessory", []],
  ] as const)(
    "shows exactly the right fields for %s",
    async (category, expected) => {
      // Derived from `garmentSchema`, not restated: a category that gains an
      // attribute in the schema gains the field here, and this is what says
      // so.
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(screen.getByLabelText("Category"), category);

      const shown = ATTRIBUTE_LABELS.filter(
        (label) => screen.queryByLabelText(label) !== null,
      );
      expect(shown).toStrictEqual(expected);
    },
  );

  it("records the attribute a user picks", async () => {
    const user = userEvent.setup();
    const { save } = renderForm();

    await user.type(screen.getByLabelText(/Model \/ name/), "Houdini");
    await user.selectOptions(screen.getByLabelText("Layer"), "outer");
    await user.selectOptions(screen.getByLabelText("Weight"), "light");
    await user.selectOptions(screen.getByLabelText("Fabric"), "synthetic");
    await user.click(screen.getByLabelText("Wind resistant"));
    await user.click(screen.getByLabelText("Water resistant"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await saved(save)).toMatchObject({
      layer: "outer",
      weight: "light",
      fabric: "synthetic",
      windResistant: true,
      waterResistant: true,
    });
  });

  it("offers every enum value the schema holds, and no other", () => {
    // The options are read from `layerSchema.options` and friends rather
    // than written out, so a value added to the contract appears here
    // without anyone editing the form. This is what says so.
    renderForm();

    expect(optionValues("Layer")).toStrictEqual(["", "base", "mid", "outer"]);
    expect(optionValues("Weight")).toStrictEqual(["", "light", "mid", "heavy"]);
    expect(optionValues("Fabric")).toStrictEqual([
      "",
      "synthetic",
      "merino",
      "cotton",
      "blend",
      "down",
    ]);
  });

  it("labels every one of them, so no row in the picker is blank", () => {
    // The values are derived from the schema; the display names are not,
    // and cannot be — "synthetic" is a contract value, "Synthetic" is
    // English. A missing one renders as an empty row that still selects a
    // real value, which no value assertion would catch. The leading em
    // dash is the "not saying" option, which is a real answer here.
    renderForm();

    expect(optionLabels("Layer")).toStrictEqual(["—", "Base", "Mid", "Outer"]);
    expect(optionLabels("Weight")).toStrictEqual(["—", "Light", "Mid", "Heavy"]);
    expect(optionLabels("Fabric")).toStrictEqual([
      "—",
      "Synthetic",
      "Merino",
      "Cotton",
      "Blend",
      "Down",
    ]);
  });

  it("offers an em-dash for 'not saying', and reads it back as absent", async () => {
    // The blank option is a real answer — most garments do not know their
    // own fabric, and forcing a pick would put an invention in the data.
    const user = userEvent.setup();
    const { save } = renderForm({ initial: { fabric: "merino" } });

    await user.type(screen.getByLabelText(/Model \/ name/), "Tee");
    await user.selectOptions(screen.getByLabelText("Fabric"), "");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await saved(save)).not.toHaveProperty("fabric");
  });
});

describe("GarmentForm: the estimate", () => {
  it("appears once the answers can support one, and follows them", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByText(/Estimated/)).toBeNull();

    await user.selectOptions(screen.getByLabelText("Layer"), "base");
    await user.selectOptions(screen.getByLabelText("Weight"), "light");

    const estimate = await screen.findByText(/Estimated/);
    const first = estimate.textContent;
    expect(first).toContain("°");
    expect(first.startsWith("Estimated [")).toBe(true);
    expect(first.endsWith("]")).toBe(true);

    // A heavier garment is a different estimate, not a stale one.
    await user.selectOptions(screen.getByLabelText("Weight"), "heavy");
    await waitFor(() => {
      expect(screen.getByText(/Estimated/).textContent).not.toBe(first);
    });
  });

  it("treats an unanswered layer or weight as unanswered, not as a value", async () => {
    // `=== "" ? undefined : …` — the blank option means "not saying", and
    // passing the empty string through to the estimator would be passing
    // it a value it has no rule for.
    const user = userEvent.setup();
    renderForm({ initial: { weight: "heavy" } });

    const weightOnly = screen.getByText(/Estimated/).textContent;

    // "outer" is the layer the estimator actually branches on.
    await user.selectOptions(screen.getByLabelText("Layer"), "outer");
    await waitFor(() => {
      expect(screen.getByText(/Estimated/).textContent).not.toBe(weightOnly);
    });

    // And back to unanswered: the estimate returns to what it was, rather
    // than treating "" as a third kind of layer.
    await user.selectOptions(screen.getByLabelText("Layer"), "");
    await waitFor(() => {
      expect(screen.getByText(/Estimated/).textContent).toBe(weightOnly);
    });
  });

  it("takes wind resistance into account", async () => {
    const user = userEvent.setup();
    renderForm({ initial: { layer: "outer", weight: "mid" } });

    const before = screen.getByText(/Estimated/).textContent;
    await user.click(screen.getByLabelText("Wind resistant"));

    await waitFor(() => {
      expect(screen.getByText(/Estimated/).textContent).not.toBe(before);
    });
  });
});

describe("GarmentForm: the product link", () => {
  it("says enrichment is pending only once a link is there", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByText(/Enrichment pending/)).toBeNull();

    await user.type(
      screen.getByLabelText("Product link"),
      "https://example.com/x",
    );

    expect(screen.getByText(/Enrichment pending/)).toBeVisible();
  });
});
