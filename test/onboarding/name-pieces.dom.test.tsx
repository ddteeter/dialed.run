import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { NamePieces } from "../../src/modules/onboarding/components/NamePieces";
import type { NameableItem, NamedResult } from "../../src/modules/onboarding/naming";

/**
 * Screen P2.5 (design §AC), whose argument is that a category cannot
 * remember.
 *
 * The assertions that matter most are the ones about what it refuses to
 * do: it never gates, it never claims to know a stranger's favourites, and
 * it never tells the runner something the build cannot back up.
 */
function piece(name: string, category = "Top"): NameableItem {
  return {
    // A slug, because the real thing is a ULID and the id ends up inside a
    // `datalist` id. The first version used the label verbatim, which put
    // a space in an HTML id — invalid, and it broke `querySelector` in a
    // way that looked like a test-harness quirk rather than a bad fixture.
    itemId: name.toLowerCase().replaceAll(" ", "-"),
    label: name,
    subtitle: `${category} · Generic`,
  };
}

const SIX = [
  piece("Running tights", "Bottom"),
  piece("Merino base layer"),
  piece("Beanie", "Headwear"),
  piece("Running gloves", "Gloves"),
  piece("Short sleeve tee"),
  piece("Running socks", "Socks"),
];

function renderScreen(
  overrides: {
    items?: readonly NameableItem[];
    totalCount?: number;
    result?: NamedResult;
    models?: readonly string[];
  } = {},
) {
  const items = overrides.items ?? SIX;
  const nameGarment = vi.fn(() =>
    Promise.resolve(
      overrides.result ?? {
        label: "Smartwool Intraknit 200",
        subtitle: "Top · Matched",
        isNamed: true,
      },
    ),
  );
  const onDone = vi.fn();
  const onBrandInput = vi.fn();
  render(
    <NamePieces
      offer={{ items, totalCount: overrides.totalCount ?? items.length }}
      nameGarment={nameGarment}
      brandOptions={["Smartwool", "Smartwater"]}
      onBrandInput={onBrandInput}
      modelOptions={overrides.models ?? ["Intraknit 200", "Classic 150"]}
      onDone={onDone}
    />,
  );
  return { nameGarment, onDone, onBrandInput };
}

const counter = () => screen.getByText(/of \d+ named$/);

/**
 * Opens the first offer. Named by what it does rather than indexed at the
 * call site, so no test needs a non-null assertion to reach it — and the
 * first row is always "Running tights", which is closet order (rule 02).
 */
async function nameFirst(user: ReturnType<typeof userEvent.setup>) {
  const [first] = screen.getAllByRole("button", { name: "Name it" });
  await user.click(first ?? screen.getByRole("button", { name: "Next" }));
}

describe("NamePieces", () => {
  it("makes the argument, in design's words", () => {
    renderScreen();

    expect(
      screen.getByText(/A category can’t remember — a product can\./),
    ).toBeVisible();
  });

  it("offers rows, never picks them", () => {
    // Design rule 01, the same doctrine as §AA: rank, never filter. A
    // screen that showed three would be claiming to know a stranger.
    renderScreen();

    expect(screen.getAllByRole("button", { name: "Name it" })).toHaveLength(5);
    expect(screen.getByRole("button", { name: /Everything else/ })).toHaveTextContent(
      "Everything else · 1 more",
    );
  });

  it("never gates: Next is live with nothing named", async () => {
    // Rule 04 — a fraction, not a quota. O3 can say "enough to start"
    // because six taps is a real threshold; naming changes nothing about
    // whether the app works today.
    const user = userEvent.setup();
    const { onDone } = renderScreen();

    expect(counter().textContent).toBe("0 of 6 named");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skips to the same place Next goes", async () => {
    // Rule 06: both land on P3, and the screen never reappears.
    const user = userEvent.setup();
    const { onDone } = renderScreen();

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("expands in place rather than navigating", async () => {
    // Rule 03: it reuses F's resolver, it is not F, and it does not leave
    // the screen — the other rows stay where they were.
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);

    expect(screen.getByLabelText("Brand")).toBeVisible();
    expect(screen.getByLabelText("Model")).toBeVisible();
    expect(screen.getByText("Brand alone is enough.")).toBeVisible();
    // Still a list of six offers, one of which is open.
    expect(screen.getByText("Merino base layer")).toBeVisible();
  });

  it("asks for no link and no photo", async () => {
    // Design rule 05, and Q3: a field that swallows a URL and shows
    // nothing would be a promise the build cannot keep — lane 107 does not
    // exist. A photo says nothing about *which* product this is.
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);

    expect(screen.queryByLabelText(/link|url/i)).toBeNull();
    expect(screen.queryByLabelText(/photo/i)).toBeNull();
  });

  it("names a piece and counts it", async () => {
    const user = userEvent.setup();
    const { nameGarment } = renderScreen();

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.type(screen.getByLabelText("Model"), "Intraknit 200");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(nameGarment).toHaveBeenCalledWith({
      data: {
        itemId: "running-tights",
        brand: "Smartwool",
        model: "Intraknit 200",
      },
    });
    await waitFor(() => {
      // Exact, not `toHaveTextContent`: that substring-matches, so a
      // counter that went *down* to "-1 of 6 named" would still contain
      // "1 of 6 named" and pass while counting backwards.
      expect(counter().textContent).toBe("1 of 6 named");
    });
    expect(screen.getByText("Smartwool Intraknit 200")).toBeVisible();
    expect(screen.getByText("Top · Matched")).toBeVisible();
  });

  it("sends no model when only a brand was given", async () => {
    // Rule 04: brand alone is a true answer, and an empty model is not a
    // product name.
    const user = userEvent.setup();
    const { nameGarment } = renderScreen({
      result: {
        label: "Running tights",
        subtitle: "Smartwool · No model",
        isNamed: false,
      },
    });

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(nameGarment).toHaveBeenCalledWith({
      data: { itemId: "running-tights", brand: "Smartwool" },
    });
  });

  it("keeps a brand-only row on offer, and out of the count", async () => {
    // The other half of rule 04. It has told us something true and is not
    // finished — counting it would inflate the fraction against the
    // runner's own sense of what they have done.
    const user = userEvent.setup();
    renderScreen({
      result: {
        label: "Running tights",
        subtitle: "Smartwool · No model",
        isNamed: false,
      },
    });

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Smartwool · No model")).toBeVisible();
    });
    expect(counter().textContent).toBe("0 of 6 named");
    expect(screen.getAllByRole("button", { name: "Name it" })).toHaveLength(5);
  });

  it("asks the schema's question when the brand is blank", async () => {
    // Error copy lives in the schema, and this one has to agree with the
    // caption above it rather than demanding both fields.
    const user = userEvent.setup();
    const { nameGarment } = renderScreen();

    await nameFirst(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(nameGarment).not.toHaveBeenCalled();
    expect(
      screen.getByText("Which brand? That alone is enough."),
    ).toBeVisible();
  });

  it("suggests brands as they are typed, and models from that brand", async () => {
    const user = userEvent.setup();
    const { onBrandInput } = renderScreen();

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smart");

    expect(onBrandInput).toHaveBeenLastCalledWith("Smart");
    // A `<datalist>` carries its suggestions as option *values*, not as
    // text, so this reads the attribute rather than the accessible name —
    // which is also why the chips design drew are a datalist here: the
    // browser's own control, not a hand-built listbox.
    const models = [
      ...document.querySelectorAll("datalist[id^='models-'] option"),
    ].map((option) => option.getAttribute("value"));
    expect(models).toEqual(["Intraknit 200", "Classic 150"]);
  });

  it("tells the runner nothing the build cannot back up", async () => {
    // Design's three payout lines need `products.type` (lane 107), an
    // owner count (no read exists) and O4's tagged runs. D-54. This is the
    // one screen whose entire job is to be believed, so it says what
    // happened and stops.
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.type(screen.getByLabelText("Model"), "Intraknit 200");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Smartwool Intraknit 200")).toBeVisible();
    });
    expect(screen.queryByText(/runners own this/i)).toBeNull();
    expect(screen.queryByText(/filter/i)).toBeNull();
    expect(screen.queryByText(/tagged runs/i)).toBeNull();
  });

  it("shows no disclosure when everything fits", () => {
    renderScreen({ items: SIX.slice(0, 3) });

    expect(screen.queryByRole("button", { name: /Everything else/ })).toBeNull();
  });

  it("reveals the rest behind the fold", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByText("Running socks")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Everything else/ }));

    expect(screen.getByText("Running socks")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Everything else/ }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("announces the piece it named, from one live region", async () => {
    // One region on the screen, and it belongs to the row's own form —
    // §Forms & failure: "two live regions firing at once means one of them
    // is lost". It names the piece, because "1 named" does not tell
    // someone who cannot see the row *which* one.
    const user = userEvent.setup();
    renderScreen();
    expect(screen.queryByRole("status")).toBeNull();

    await nameFirst(user);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.type(screen.getByLabelText("Model"), "Intraknit 200");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(counter().textContent).toBe("1 of 6 named");
    });
  });

  it("says which piece was named, not just that one was", async () => {
    const user = userEvent.setup();
    renderScreen({
      result: {
        label: "Running tights",
        subtitle: "Smartwool · No model",
        isNamed: false,
      },
    });

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "Running tights named.",
      );
    });
  });

  it("takes a finished row off offer", async () => {
    // The other side of rule 04's brand-only case: a linked product is
    // done, so the offer goes away rather than inviting a second answer.
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");
    await user.type(screen.getByLabelText("Model"), "Intraknit 200");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // **Wait for the save to land, then count — not the other way round.**
    // While the form was open the count was already 4, so a `waitFor` on
    // the count succeeds on its first check and never sees the row come
    // back. That passed against a build where a named row kept its offer.
    await waitFor(() => {
      expect(screen.getByText("Smartwool Intraknit 200")).toBeVisible();
    });
    expect(screen.getAllByRole("button", { name: "Name it" })).toHaveLength(4);
  });

  it("hides the offer while its own form is open", async () => {
    // Only one row expands at a time, and the row being named does not
    // also offer to start naming itself.
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);

    expect(screen.getAllByRole("button", { name: "Name it" })).toHaveLength(4);
  });

  it("wires each field to its own suggestion list", async () => {
    // The ids are per-row, because five rows would otherwise share one
    // datalist and offer a brand's models against a different garment.
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);

    const brand = screen.getByLabelText("Brand");
    const model = screen.getByLabelText("Model");
    expect(model).toHaveAttribute("name", "model");
    expect(brand).toHaveAttribute("name", "brand");
    // The `list` on each input names a datalist that exists, and the two
    // are different lists — one row's brands must not be offered as
    // another's models.
    const lists = [brand, model].map((input) => input.getAttribute("list"));
    expect(new Set(lists).size).toBe(2);
    for (const id of lists) {
      expect(document.querySelector(`#${id ?? ""}`)).not.toBeNull();
    }
  });

  it("offers the brands it was given", async () => {
    const user = userEvent.setup();
    renderScreen();

    await nameFirst(user);

    const brands = [
      ...document.querySelectorAll("datalist[id^='brands-'] option"),
    ].map((option) => option.getAttribute("value"));
    expect(brands).toEqual(["Smartwool", "Smartwater"]);
  });

  it("never lets the browser submit the naming form itself", async () => {
    const user = userEvent.setup();
    renderScreen();
    await nameFirst(user);
    await user.type(screen.getByLabelText("Brand"), "Smartwool");

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

    expect(prevented).toBe(true);
  });
});
