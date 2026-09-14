import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { fibreCandidates } from "../../../src/db/schema-core";
import { env } from "../../../src/env";
import type {
  ExtractedProduct,
  ExtractionModel,
} from "../../../src/lib/contracts";
import { newUlid } from "../../../src/lib/ids";
import {
  modelPass,
  requiresModel,
  unknownFibres,
} from "../../../src/modules/enrichment/model/rung";

/**
 * When the model is worth asking, and what the asking teaches the
 * vocabulary. The candidate rows are the feedback loop's whole mechanism,
 * so they are read back out of a real D1 rather than asserted on a spy.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

const MERINO: ExtractedProduct = {
  fabricComposition: {
    verbatim: "100% merino wool",
    parts: [{ materials: [{ material: "merino wool", pct: 100 }] }],
  },
};

const PROPRIETARY: ExtractedProduct = {
  fabricComposition: {
    verbatim: "Toray Primeflex: 100% Primeflex",
    parts: [{ materials: [{ material: "primeflex", pct: 100 }] }],
  },
};

function modelAnswering(found: ExtractedProduct) {
  return { extract: vi.fn(() => Promise.resolve(found)) };
}

function page(productId: string, snapshotId: string) {
  return {
    html: "<p>100% merino wool</p>",
    url: "https://shop.example.com/products/tee",
    snapshotId,
    productId,
  };
}

async function candidatesFor(snapshotId: string) {
  return db()
    .select()
    .from(fibreCandidates)
    .where(eq(fibreCandidates.snapshotId, snapshotId));
}

describe("requiresModel", () => {
  it("asks when the deterministic rungs found no composition", () => {
    expect(requiresModel({})).toBe(true);
    expect(requiresModel({ name: "Rover Tee", brand: "Janji" })).toBe(true);
  });

  it("does not ask when a shop already stated its composition", () => {
    // A shop publishing JSON-LD has answered better than a model can, so
    // asking one is spending money for a worse answer.
    expect(requiresModel(MERINO)).toBe(false);
  });

  it("asks for the composition and nothing else", () => {
    // Name, brand and image come from Open Graph on essentially every
    // page, so a model asked for them is an expensive way to re-read a
    // `<meta>` tag. If that stops being true, this test says where to
    // change it.
    const everythingButComposition: ExtractedProduct = {
      name: "Rover Tee",
      brand: "Janji",
      imageUrl: "https://cdn.example.com/tee.jpg",
      weight: "light",
      fabric: "merino",
      categoryHint: "top",
      windResistant: false,
      waterResistant: false,
    };
    expect(requiresModel(everythingButComposition)).toBe(true);
  });
});

describe("unknownFibres", () => {
  it("finds nothing when every material names a fibre we know", () => {
    expect(unknownFibres(MERINO)).toStrictEqual([]);
  });

  it("finds a proprietary fibre, which is the whole point of the list", () => {
    expect(unknownFibres(PROPRIETARY)).toStrictEqual(["primeflex"]);
  });

  it("finds nothing in an extraction with no composition at all", () => {
    expect(unknownFibres({})).toStrictEqual([]);
    expect(unknownFibres({ fabricComposition: { verbatim: "soft" } })).toStrictEqual([]);
  });

  it("reports one candidate for a word that appears twice", () => {
    const twice: ExtractedProduct = {
      fabricComposition: {
        verbatim: "Body: 100% Primeflex; Liner: 100% Primeflex",
        parts: [
          { part: "Body", materials: [{ material: "Primeflex", pct: 100 }] },
          { part: "Liner", materials: [{ material: "primeflex", pct: 100 }] },
        ],
      },
    };
    expect(unknownFibres(twice)).toStrictEqual(["primeflex"]);
  });

  it("keeps a known fibre's qualifier out of the candidates", () => {
    // "recycled polyester" is polyester. A list that learned
    // "recycled polyester" as a separate fibre would grow forever.
    const qualified: ExtractedProduct = {
      fabricComposition: {
        verbatim: "91% recycled polyester, 9% spandex",
        parts: [
          {
            materials: [
              { material: "recycled polyester", pct: 91 },
              { material: "spandex", pct: 9 },
            ],
          },
        ],
      },
    };
    expect(unknownFibres(qualified)).toStrictEqual([]);
  });
});

function deps(model: ExtractionModel) {
  return { db: db(), model };
}

describe("modelPass", () => {
  it("fills a blank the deterministic rungs left, and says it did", async () => {
    const model = modelAnswering(MERINO);
    const pass = await modelPass(deps(model), {}, page(newUlid(), newUlid()));

    expect(pass.didContribute).toBe(true);
    expect(pass.extracted.fabricComposition?.verbatim).toBe("100% merino wool");
    // The page as prose, not as markup.
    expect(model.extract).toHaveBeenCalledWith("100% merino wool", {
      url: "https://shop.example.com/products/tee",
    });
  });

  it("never overwrites what a shop declared", async () => {
    // The ladder's own rule: a declared field beats an inferred one,
    // whatever order they ran in.
    const declared: ExtractedProduct = {
      fabricComposition: { verbatim: "declared by the shop" },
    };
    const pass = await modelPass(
      deps(modelAnswering(MERINO)),
      declared,
      page(newUlid(), newUlid()),
    );

    expect(pass.didContribute).toBe(false);
    expect(pass.extracted.fabricComposition?.verbatim).toBe(
      "declared by the shop",
    );
  });

  it("records a fibre the vocabulary does not know, with its evidence", async () => {
    // What a reviewer needs is the sentence the word appeared in: it is
    // what makes `primeflex` a fibre and `pacerweave` a part label.
    const productId = newUlid();
    const snapshotId = newUlid();
    await modelPass(
      deps(modelAnswering(PROPRIETARY)),
      {},
      page(productId, snapshotId),
    );

    const [candidate] = await candidatesFor(snapshotId);
    expect(candidate).toMatchObject({
      material: "primeflex",
      productId,
      snapshotId,
      verbatim: "Toray Primeflex: 100% Primeflex",
    });
    // Epoch *seconds*, like every other timestamp in this schema. Stored in
    // milliseconds it reads as a date in the year 57000, and every
    // comparison against another column is wrong by a factor of a thousand.
    const now = Math.floor(Date.now() / 1000);
    expect(candidate?.seenAt).toBeGreaterThan(now - 60);
    expect(candidate?.seenAt).toBeLessThanOrEqual(now);
  });

  it("records nothing when every fibre is already known", async () => {
    const snapshotId = newUlid();
    await modelPass(
      deps(modelAnswering(MERINO)),
      {},
      page(newUlid(), snapshotId),
    );
    expect(await candidatesFor(snapshotId)).toStrictEqual([]);
  });

  it("records nothing, and does not fail, when the model found no composition", async () => {
    // "Nothing to record" and "it blew up" are no longer the same shape:
    // a failure propagates now, so completing quietly is the assertion.
    const snapshotId = newUlid();
    const pass = await modelPass(
      deps(modelAnswering({ name: "Rover Tee" })),
      {},
      page(newUlid(), snapshotId),
    );

    expect(pass.didContribute).toBe(true);
    expect(await candidatesFor(snapshotId)).toStrictEqual([]);
  });

  it("re-runs over one snapshot without duplicating its candidates", async () => {
    // A redelivery and a `reextract` both re-derive the same candidates.
    // Idempotency lives in the UNIQUE index, not in the consumer
    // remembering (law 1).
    const snapshotId = newUlid();
    const productId = newUlid();
    for (let run = 0; run < 3; run += 1) {
      await modelPass(
        deps(modelAnswering(PROPRIETARY)),
        {},
        page(productId, snapshotId),
      );
    }
    expect(await candidatesFor(snapshotId)).toHaveLength(1);
  });

  it("lets a model failure through, so the job can be retried", async () => {
    // **It used to swallow this**, and that became wrong the moment the
    // model was the only source of composition: a caught error means the
    // job writes a product with none and marks it `done`, and
    // `requestEnrichment` never claims a `done` row again — so one
    // transient outage would permanently cost that product its
    // composition. The queue's retry is the mechanism (law 3).
    const failing: ExtractionModel = {
      extract: () => Promise.reject(new Error("upstream")),
    };

    const attempt = modelPass(
      deps(failing),
      { name: "Rover Tee" },
      page(newUlid(), newUlid()),
    );
    await expect(attempt).rejects.toThrow("upstream");
  });

  it("records candidates before the caller can act on the answer", async () => {
    // A page that named a new fibre teaches the vocabulary even if what
    // happens next fails, because the recording is done by the time this
    // returns.
    const snapshotId = newUlid();
    const pass = await modelPass(
      deps(modelAnswering(PROPRIETARY)),
      {},
      page(newUlid(), snapshotId),
    );
    expect(pass.didContribute).toBe(true);
    expect(await candidatesFor(snapshotId)).toHaveLength(1);
  });
});
