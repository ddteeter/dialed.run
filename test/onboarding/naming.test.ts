import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  addFromTapList,
  getOwnedItem,
  nameItem,
} from "../../src/modules/closet";
import {
  namedResult,
  namingOffer,
  namingSuggestions,
} from "../../src/modules/onboarding/naming";
import {
  brandPrefixInput,
  nameGarmentInput,
  nameIdentityInput,
} from "../../src/modules/onboarding/inputs";
import { resetTables } from "../feed/helpers";

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

/**
 * Screen P2.5 (design §AC), against the closet a tap list actually makes.
 *
 * Seeded through `addFromTapList` rather than by inserting rows, because
 * the premise of the screen is "everything O3 created is generic" — and a
 * hand-built fixture could be generic when the real write path is not.
 */
async function seededCloset(keys: string[]) {
  const userId = newUlid();
  await addFromTapList(coreDb(), userId, { keys });
  return userId;
}

/**
Whatever P2.5 would offer this runner first — closet order, so the first
key seeded.
*/
async function firstOffer(userId: string) {
  const offer = await namingOffer(coreDb(), userId);
  const [row] = offer.items;
  return row;
}

/**
A brand nobody else could have typed. `brands` and `products` are shared
catalogues, seeded with a curated list and deliberately not cleared by
`resetTables` — they are the vocabulary every account writes into, not one
account's data. The first version of these tests asserted against
"Patagonia" and "Smartwool" and failed on both: one is in the seed list,
the other had been created by a test above.
*/
function uniqueBrand() {
  return `Brand${newUlid()}`;
}

beforeEach(async () => {
  await resetTables();
});

describe("namingOffer", () => {
  it("offers every generic piece, never a chosen few", async () => {
    // Design §AC rule 01, the same doctrine as §AA's one list: the order
    // carries the suggestion and nothing is filtered out. A screen that
    // picked three would be claiming to know a stranger's favourites.
    const userId = await seededCloset(["tights", "beanie", "tee", "socks"]);

    const offer = await namingOffer(coreDb(), userId);

    expect(offer.items).toHaveLength(4);
    expect(offer.totalCount).toBe(4);
  });

  it("says what each piece is, in the Z language", async () => {
    const userId = await seededCloset(["beanie"]);

    const offer = await namingOffer(coreDb(), userId);

    expect(offer.items[0]).toMatchObject({
      label: "Beanie",
      subtitle: "Headwear · Generic",
    });
  });

  it("drops a piece once it has been named", async () => {
    // P2.5 runs once, right after O3, so in practice everything is
    // generic — but a named row must not come back asking again. The
    // closet nudge is the follow-up, not this screen (rule 06).
    const userId = await seededCloset(["tights", "beanie"]);
    const before = await namingOffer(coreDb(), userId);
    const beanie = before.items.find((row) => row.label === "Beanie");

    await nameItem(coreDb(), userId, beanie?.itemId ?? "", {
      brand: "Smartwool",
      model: "Merino 250 Cuffed Beanie",
    });
    const after = await namingOffer(coreDb(), userId);

    expect(after.items.map((row) => row.label)).toEqual(["Running tights"]);
    // The denominator is the whole closet, so the counter reads "1 of 2".
    expect(after.totalCount).toBe(2);
  });

  it("is empty for a runner who skipped the tap list", async () => {
    // Reachable: O3 is skippable. An empty offer is what lets the route
    // send them straight on rather than showing a screen with no rows.
    const offer = await namingOffer(coreDb(), newUlid());

    expect(offer.items).toEqual([]);
    expect(offer.totalCount).toBe(0);
  });
});

describe("nameItem", () => {
  it("links a product and keeps the row", async () => {
    // Design §AC rule 05: naming links a record, it never replaces one.
    // The id surviving is what keeps every verdict and wear count attached.
    const userId = await seededCloset(["merino-base"]);
    const offer = await namingOffer(coreDb(), userId);
    const [row] = offer.items;

    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
      model: "Intraknit 200",
    });

    expect(named.id).toBe(row?.itemId);
    expect(named.brand).toBe("Smartwool");
    expect(named.name).toBe("Intraknit 200");
    expect(named.productId).not.toBeNull();
  });

  it("flips origin off the tap list, because a person said what it is", async () => {
    const userId = await seededCloset(["merino-base"]);
    const offer = await namingOffer(coreDb(), userId);
    const [row] = offer.items;
    const before = await getOwnedItem(coreDb(), userId, row?.itemId ?? "");
    expect(before.origin).toBe("taplist");

    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
      model: "Intraknit 200",
    });

    expect(named.origin).toBe("manual");
  });

  it("takes a brand alone, and links no product for it", async () => {
    // Rule 04. A runner who knows it is a Smartwool and not which one gets
    // the brand — resolving a product from a blank model would invent a
    // canonical row named after nothing, and products are shared.
    const userId = await seededCloset(["merino-base"]);
    const offer = await namingOffer(coreDb(), userId);
    const [row] = offer.items;

    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
    });

    expect(named.brand).toBe("Smartwool");
    expect(named.productId).toBeNull();
    // The tap list's own words survive: there is no model to replace them.
    expect(named.name).toBe("Merino base layer");
    // And this branch flips origin as surely as the model branch does — a
    // person said what it is, so it is no longer the tap list's guess.
    // Asserted here because the branch writes its own `origin`, and the
    // model path's test cannot reach this one.
    expect(named.origin).toBe("manual");
  });

  it("treats a blank model as no model", async () => {
    // The form sends "" for an untouched optional field, and "  " for one
    // someone tabbed through. Neither is a product name.
    const userId = await seededCloset(["merino-base"]);
    const offer = await namingOffer(coreDb(), userId);
    const [row] = offer.items;

    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
      model: " ".repeat(3),
    });

    expect(named.productId).toBeNull();
  });

  it("stays on offer when only the brand is known", async () => {
    // Rule 04's second half: brand-only is a partial answer, so the row is
    // still generic and still listed.
    const userId = await seededCloset(["merino-base"]);
    const offer = await namingOffer(coreDb(), userId);
    const [row] = offer.items;

    await nameItem(coreDb(), userId, row?.itemId ?? "", { brand: "Smartwool" });

    const afterOffer = await namingOffer(coreDb(), userId);
    expect(afterOffer.items).toHaveLength(1);
  });

  it("refuses a garment that is not yours", async () => {
    const owner = await seededCloset(["merino-base"]);
    const offer = await namingOffer(coreDb(), owner);
    const [row] = offer.items;

    await expect(
      nameItem(coreDb(), newUlid(), row?.itemId ?? "", { brand: "Smartwool" }),
    ).rejects.toThrow();
  });
});

describe("namedResult", () => {
  it("states the identity a linked piece gained", async () => {
    const userId = await seededCloset(["merino-base"]);
    const row = await firstOffer(userId);
    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
      model: "Intraknit 200",
    });

    expect(namedResult(named)).toEqual({
      label: "Smartwool Intraknit 200",
      subtitle: "Top · Matched",
      isNamed: true,
    });
  });

  it("says what a brand-only row now knows, and that it is unfinished", async () => {
    // Design rule 04. `isNamed: false` is what keeps it on offer and out
    // of the counter.
    const userId = await seededCloset(["merino-base"]);
    const row = await firstOffer(userId);
    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
    });

    expect(namedResult(named)).toEqual({
      label: "Merino base layer",
      subtitle: "Smartwool · No model",
      isNamed: false,
    });
  });

  it("tells the runner none of the three things it cannot know", async () => {
    // D-54: type comes from lane 107, an owner count has no read, and
    // tagged runs need O4. This is the one screen design says has to be
    // believed, so nothing here may imply any of them.
    const userId = await seededCloset(["merino-base"]);
    const row = await firstOffer(userId);
    const named = await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand: "Smartwool",
      model: "Intraknit 200",
    });

    const result = namedResult(named);

    expect(`${result.label} ${result.subtitle}`).not.toMatch(
      /runners|filter|tagged/i,
    );
  });
});

describe("namedResult on a row nobody has named", () => {
  it("says exactly what the offer list says", async () => {
    // The same sentence in both places, from one function: a row has to
    // read identically wherever it appears.
    const userId = await seededCloset(["beanie"]);
    const offered = await firstOffer(userId);
    const row = await getOwnedItem(coreDb(), userId, offered?.itemId ?? "");

    expect(namedResult(row)).toEqual({
      label: "Beanie",
      subtitle: offered?.subtitle,
      isNamed: false,
    });
    expect(offered?.subtitle).toBe("Headwear · Generic");
  });
});

describe("namingSuggestions", () => {
  it("offers brands by prefix and that brand's products", async () => {
    const brand = uniqueBrand();
    const userId = await seededCloset(["merino-base"]);
    const row = await firstOffer(userId);
    await nameItem(coreDb(), userId, row?.itemId ?? "", {
      brand,
      model: "Intraknit 200",
    });

    // A partial brand matches brands and *not* products: there is no brand
    // yet to have products, which is why `productsForBrand` takes a
    // complete name where `searchBrands` takes a prefix. The chips appear
    // when the brand does.
    expect(await namingSuggestions(coreDb(), brand.slice(0, 8))).toEqual({
      brands: [brand],
      models: [],
    });
    expect(await namingSuggestions(coreDb(), brand)).toEqual({
      brands: [brand],
      models: ["Intraknit 200"],
    });
  });

  it("offers nothing for a brand nobody has typed yet", async () => {
    expect(await namingSuggestions(coreDb(), uniqueBrand())).toEqual({
      brands: [],
      models: [],
    });
  });

  it("creates no brand while someone is still typing", async () => {
    // A lookup that created a row per keystroke would fill the shared
    // vocabulary with fragments — "B", "Br", "Bra".
    const typing = uniqueBrand();
    await namingSuggestions(coreDb(), typing);

    expect(await namingSuggestions(coreDb(), typing)).toEqual({
      brands: [],
      models: [],
    });
  });
});

describe("the naming schemas", () => {
  it("asks for a brand in words that match the screen's own caption", () => {
    const failed = nameIdentityInput.safeParse({ brand: "" });

    expect(failed.success).toBe(false);
    expect(failed.error?.issues[0]?.message).toBe(
      "Which brand? That alone is enough.",
    );
  });

  it("takes a brand alone", () => {
    expect(nameIdentityInput.parse({ brand: "Smartwool" })).toEqual({
      brand: "Smartwool",
    });
  });

  it("trims both fields, because a typed space is not a name", () => {
    expect(
      nameIdentityInput.parse({ brand: "  Smartwool  ", model: " 250 " }),
    ).toEqual({ brand: "Smartwool", model: "250" });
  });

  it("refuses a model that is only whitespace", () => {
    // It trims to "", and an empty product name would create a canonical
    // product named after nothing.
    expect(
      nameIdentityInput.safeParse({ brand: "S", model: " ".repeat(3) }).success,
    ).toBe(false);
  });

  it("needs to know which garment is being named", () => {
    expect(nameGarmentInput.safeParse({ brand: "Smartwool" }).success).toBe(
      false,
    );
    // A ULID, not any non-empty string: item ids are ULIDs everywhere else
    // and this is a trust boundary.
    expect(
      nameGarmentInput.safeParse({ brand: "Smartwool", itemId: "abc" }).success,
    ).toBe(false);
    expect(
      nameGarmentInput.safeParse({ brand: "Smartwool", itemId: newUlid() })
        .success,
    ).toBe(true);
  });

  it("bounds the brand prefix a keystroke can send", () => {
    expect(brandPrefixInput.safeParse({ brand: "S" }).success).toBe(true);
    expect(brandPrefixInput.safeParse({ brand: "S".repeat(61) }).success).toBe(
      false,
    );
  });
});
