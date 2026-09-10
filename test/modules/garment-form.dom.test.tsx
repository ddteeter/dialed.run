import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GarmentForm } from "../../src/modules/closet/components/GarmentForm";
import { garmentCategoriesInOrder } from "../../src/lib/garment-fields";

/**
 * Screen F, driven.
 *
 * The form's whole subject is which fields a category admits, and that is
 * derived from `garmentSchema` rather than restated — so the assertion
 * worth making is that the rendered form and the schema agree, for every
 * category, rather than that one arrangement produces some markup.
 */

function nothing() {
  // the submit is not what is under test here
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
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Model \/ name/), "Long sleeve top");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Long sleeve top",
      brand: "",
      category: "top",
    });
  });

  it("offers every category, in the contract's order, with its label", () => {
    render(<GarmentForm onSubmit={nothing} />);

    const select = document.querySelector("select");
    const options = [...(select?.options ?? [])];

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
    render(<GarmentForm onSubmit={nothing} />);

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

  it("submits those blanks as blanks", async () => {
    // The rendered `<select>` cannot tell us this on its own: a value that
    // matches no option shows as the first option regardless, so an
    // initial value of nonsense looks identical to an initial value of "".
    // What the caller receives is the thing that matters.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Model \/ name/), "Tee");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit.mock.calls[0]?.[0]).toStrictEqual({
      brand: "",
      name: "Tee",
      category: "top",
      size: "",
      color: "",
      productUrl: "",
      layer: "",
      weight: "",
      fabric: "",
      windResistant: false,
      waterResistant: false,
    });
  });

  it("records the plain text fields a user types", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Model \/ name/), "Harrier");
    await user.type(screen.getByLabelText("Size"), "M");
    await user.type(screen.getByLabelText("Color"), "Navy");
    await user.type(
      screen.getByLabelText("Product link"),
      "https://example.com/harrier",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      name: "Harrier",
      size: "M",
      color: "Navy",
      productUrl: "https://example.com/harrier",
    });
  });

  it("submits through its own handler, never the browser's", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} />);
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

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("starts from the values it is given, and keeps the rest empty", () => {
    render(
      <GarmentForm
        onSubmit={nothing}
        initial={{ brand: "Tracksmith", name: "Harrier", category: "shoes" }}
        submitLabel="Save changes"
      />,
    );

    expect(screen.getByLabelText(/Brand/)).toHaveValue("Tracksmith");
    expect(screen.getByLabelText(/Model \/ name/)).toHaveValue("Harrier");
    expect(screen.getByLabelText("Category")).toHaveValue("shoes");
    expect(screen.getByLabelText("Size")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeVisible();
  });
});

describe("GarmentForm: the brand suggestions", () => {
  it("reports what is typed so the caller can fetch matches", async () => {
    const user = userEvent.setup();
    const onBrandInput = vi.fn();
    render(<GarmentForm onSubmit={nothing} onBrandInput={onBrandInput} />);

    await user.type(screen.getByLabelText(/Brand/), "Tra");

    expect(onBrandInput).toHaveBeenLastCalledWith("Tra");
  });

  it("offers the caller's options, and renders an empty list without one", () => {
    const { rerender } = render(
      <GarmentForm onSubmit={nothing} brandOptions={["Tracksmith", "Nike"]} />,
    );
    expect(brandOptions()).toStrictEqual(["Tracksmith", "Nike"]);

    // `?? []`: no options is a datalist with nothing in it, not a crash.
    rerender(<GarmentForm onSubmit={nothing} />);
    expect(brandOptions()).toStrictEqual([]);
  });

  it("takes a brand happily with nobody listening", async () => {
    // `onBrandInput?.()` — the prop is optional, and the edit screen does
    // not pass one. Without the optional call this throws on the first
    // keystroke.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    // An exception thrown inside an event handler surfaces as an uncaught
    // error rather than failing the assertion that follows it, so it has
    // to be listened for. Without the optional call this throws on every
    // keystroke and the form still looks like it works.
    const raised: string[] = [];
    const watch = (event: ErrorEvent) => {
      raised.push(event.message);
    };
    globalThis.addEventListener("error", watch);
    try {
      render(<GarmentForm onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText(/Brand/), "Nike");
      await user.type(screen.getByLabelText(/Model \/ name/), "Pegasus");
      await user.click(screen.getByRole("button", { name: "Save" }));
    } finally {
      globalThis.removeEventListener("error", watch);
    }

    expect(raised).toStrictEqual([]);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ brand: "Nike" });
  });

  it("still records the brand it was given while suggesting", async () => {
    // Both halves of the change handler: the field updates *and* the
    // caller hears about it. Dropping either leaves the other looking fine.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} onBrandInput={nothing} />);

    await user.type(screen.getByLabelText(/Brand/), "Nike");
    await user.type(screen.getByLabelText(/Model \/ name/), "Pegasus");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ brand: "Nike" });
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
  ] as const)("shows exactly the right fields for %s", async (category, expected) => {
    // Derived from `garmentSchema`, not restated: a category that gains an
    // attribute in the schema gains the field here, and this is what says
    // so.
    const user = userEvent.setup();
    render(<GarmentForm onSubmit={nothing} />);

    await user.selectOptions(screen.getByLabelText("Category"), category);

    const shown = ATTRIBUTE_LABELS.filter(
      (label) => screen.queryByLabelText(label) !== null,
    );
    expect(shown).toStrictEqual(expected);
  });

  it("records the attribute a user picks", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/Model \/ name/), "Houdini");
    await user.selectOptions(screen.getByLabelText("Layer"), "outer");
    await user.selectOptions(screen.getByLabelText("Weight"), "light");
    await user.selectOptions(screen.getByLabelText("Fabric"), "synthetic");
    await user.click(screen.getByLabelText("Wind resistant"));
    await user.click(screen.getByLabelText("Water resistant"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      layer: "outer",
      weight: "light",
      fabric: "synthetic",
      windResistant: true,
      waterResistant: true,
    });
  });

  it("offers an em-dash for 'not saying', and reads it back as empty", async () => {
    // The blank option is a real answer — most garments do not know their
    // own fabric, and forcing a pick would put an invention in the data.
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<GarmentForm onSubmit={onSubmit} initial={{ fabric: "merino" }} />);

    await user.type(screen.getByLabelText(/Model \/ name/), "Tee");
    await user.selectOptions(screen.getByLabelText("Fabric"), "");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ fabric: "" });
  });
});

describe("GarmentForm: the estimate", () => {
  it("appears once the answers can support one, and follows them", async () => {
    const user = userEvent.setup();
    render(<GarmentForm onSubmit={nothing} />);

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
    render(<GarmentForm onSubmit={nothing} initial={{ weight: "heavy" }} />);

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
    render(<GarmentForm onSubmit={nothing} initial={{ layer: "outer", weight: "mid" }} />);

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
    render(<GarmentForm onSubmit={nothing} />);

    expect(screen.queryByText(/Enrichment pending/)).toBeNull();

    await user.type(
      screen.getByLabelText("Product link"),
      "https://example.com/x",
    );

    expect(screen.getByText(/Enrichment pending/)).toBeVisible();
  });
});
