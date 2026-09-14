import { describe, expect, it, vi } from "vitest";

import type {
  ExtractedProduct,
  ExtractionModel,
} from "../../../src/lib/contracts";
import { modelPass } from "../../../src/modules/enrichment/model/rung";

/**
 * When the model is worth asking, and what comes back.
 *
 * **The `fibre_candidates` half of this suite went with the table**
 * (2026-09-14). It recorded materials the vocabulary did not know so that a
 * human could promote them into `fibres.ts`, which improved the prose
 * search — and the prose search is gone, so the loop had no consumer left.
 */

const MERINO: ExtractedProduct = {
  fabricComposition: {
    verbatim: "100% merino wool",
    parts: [{ materials: [{ material: "merino wool", pct: 100 }] }],
  },
};

function modelAnswering(found: ExtractedProduct) {
  return { extract: vi.fn(() => Promise.resolve(found)) };
}

function deps(model: ExtractionModel) {
  return { model };
}

function page() {
  return {
    html: "<p>100% merino wool</p>",
    url: "https://shop.example.com/products/tee",
  };
}

describe("modelPass", () => {
  it("fills a blank the deterministic rungs left, and says it did", async () => {
    const model = modelAnswering(MERINO);
    const pass = await modelPass(deps(model), {}, page());

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
    const pass = await modelPass(deps(modelAnswering(MERINO)), declared, page());

    expect(pass.didContribute).toBe(false);
    expect(pass.extracted.fabricComposition?.verbatim).toBe(
      "declared by the shop",
    );
  });

  it("says it contributed nothing when the model found nothing", async () => {
    const pass = await modelPass(deps(modelAnswering({})), {}, page());
    expect(pass.didContribute).toBe(false);
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

    const attempt = modelPass(deps(failing), { name: "Rover Tee" }, page());
    await expect(attempt).rejects.toThrow("upstream");
  });
});
