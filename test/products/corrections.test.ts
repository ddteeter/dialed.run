import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  brands,
  domainDenylist,
  notifications,
  productCorrections,
  products,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { orSqlNull } from "../../src/lib/sql/sql-null";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { NotFoundError } from "../../src/lib/errors";
import { FIELD_REFUSAL_CODE } from "../../src/lib/field-refusal";
import {
  applyCorrection,
  correctionContext,
  correctionsQueue,
  declineCorrection,
  fileCorrection,
  waitingCorrectionsCountOf,
} from "../../src/modules/products";
import {
  CORRECTIONS_PAGE,
  type CorrectionKey,
} from "../../src/modules/products/correction-queue";
import {
  CORRECTION_LIMIT_REACHED,
  CORRECTIONS_PER_DAY,
  FieldNotOnPieceError,
} from "../../src/modules/products/corrections";
import { controlRefusalMessage } from "../../src/lib/control-refusal";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products/service";
import { deleteAllFrom, makeItem, makeUser } from "../feed/helpers";
import { resetTables } from "../feed/helpers";

const NOTHING = z.null().parse(JSON.parse("null"));

function core() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await deleteAllFrom(core(), [productCorrections, products, brands]);
  await resetTables();
});

interface Setup {
  productId: string;
  brandId: string;
}

async function product(name = "AFO Middle Layer"): Promise<Setup> {
  const owner = await makeUser();
  const brand = await createOrGetBrand(core(), "Janji");
  const made = await createOrGetProduct(core(), {
    brandId: brand.id,
    name,
    createdBy: owner,
  });
  await core()
    .update(products)
    .set({ weight: "mid", fabric: "synthetic", windResistant: true })
    .where(eq(products.id, made.id));
  return { productId: made.id, brandId: brand.id };
}

/**
A runner who owns a garment of the product, which is where WRONG? opens.
*/
async function owner(
  productId: string,
  username?: string,
  category: NonNullable<Parameters<typeof makeItem>[0]["category"]> = "top",
): Promise<{ userId: string; garmentId: string }> {
  const userId = await makeUser(username === undefined ? {} : { username });
  const garmentId = await makeItem({ userId, category });
  await core()
    .update(wardrobeItems)
    .set({ productId })
    .where(eq(wardrobeItems.id, garmentId));
  return { userId, garmentId };
}

async function file(
  who: { userId: string; garmentId: string },
  productId: string,
  field:
    "weight" | "name" | "fabric" | "water" | "wind" | "link" | "composition",
  value: string,
  extra: { note?: string; idempotencyKey?: string } = {},
): Promise<void> {
  await fileCorrection(who.userId, {
    productId,
    garmentId: who.garmentId,
    field,
    value,
    note: extra.note,
    idempotencyKey: extra.idempotencyKey ?? newUlid(),
  });
}

async function rowsOf(userId: string) {
  return core()
    .select()
    .from(productCorrections)
    .where(eq(productCorrections.userId, userId));
}

async function bellOf(userId: string) {
  return core()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

async function productRow(productId: string) {
  const [row] = await core()
    .select()
    .from(products)
    .where(eq(products.id, productId));
  if (row === undefined) throw new Error("no product");
  return row;
}

describe("filing a correction (R48·129)", () => {
  it("files one waiting row, with the note and the garment it came from", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light", {
      note: "It's on the maker's page.",
    });
    const [row] = await rowsOf(ada.userId);
    expect(row).toMatchObject({
      productId,
      garmentId: ada.garmentId,
      field: "weight",
      value: "light",
      note: "It's on the maker's page.",
      status: "waiting",
      decidedAt: NOTHING,
    });
  });

  it("stores no note for an empty one", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light", { note: "" });
    const [row] = await rowsOf(ada.userId);
    expect(row?.note).toBeNull();
  });

  it("replaces a waiting correction to the same field, with a new date (R48·129e)", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light", { note: "first" });
    await core()
      .update(productCorrections)
      .set({ createdAt: 1 })
      .where(eq(productCorrections.userId, ada.userId));
    await file(ada, productId, "weight", "heavy");
    const rows = await rowsOf(ada.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("heavy");
    expect(rows[0]?.note).toBeNull();
    expect(rows[0]?.createdAt).toBeGreaterThan(1);
  });

  it("files a different field as a new correction", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(ada, productId, "water", "yes");
    expect(await rowsOf(ada.userId)).toHaveLength(2);
  });

  it("files a new one once the first is decided", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light");
    await declineCorrection({
      actorId: "op",
      key: { productId, field: "weight", value: "light" },
      reason: "none",
    });
    await file(ada, productId, "weight", "light");
    const rows = await rowsOf(ada.userId);
    const statuses = rows.map((row) => row.status);
    const ordered = statuses.toSorted((left, right) =>
      left.localeCompare(right),
    );
    expect(ordered).toStrictEqual(["declined", "waiting"]);
  });

  it("changes nothing on a repeat of the same key (law 8b)", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    const idempotencyKey = newUlid();
    await file(ada, productId, "weight", "light", { idempotencyKey });
    await file(ada, productId, "weight", "heavy", { idempotencyKey });
    const rows = await rowsOf(ada.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("light");
  });

  it("refuses a garment that is not the runner's, or not this product", async () => {
    const { productId } = await product();
    const other = await product("Rover Half-Zip");
    const ada = await owner(productId);
    const bo = await owner(productId);
    await expect(
      file(
        { userId: ada.userId, garmentId: bo.garmentId },
        productId,
        "weight",
        "light",
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    const notTheProduct = file(ada, other.productId, "weight", "light");
    await expect(notTheProduct).rejects.toBeInstanceOf(NotFoundError);
    await expect(notTheProduct).rejects.toThrow("Garment not found.");
    expect(await rowsOf(ada.userId)).toHaveLength(0);
  });

  it("refuses a field the piece's category does not have, on the field", async () => {
    // The sheet never offers weight on a shoe; a stale one could still send
    // it, and the Desk would then set a fact no shoe shows.
    const { productId } = await product();
    const ada = await owner(productId, undefined, "shoes");
    const weight = file(ada, productId, "weight", "light");
    await expect(weight).rejects.toBeInstanceOf(FieldNotOnPieceError);
    await expect(weight).rejects.toMatchObject({
      code: FIELD_REFUSAL_CODE,
      message: "This piece doesn't have that.",
      issues: [{ path: ["field"], message: "This piece doesn't have that." }],
    });
    expect(await rowsOf(ada.userId)).toHaveLength(0);

    await file(ada, productId, "water", "yes");
    await file(ada, productId, "link", "https://shop.example/afo");
    const filed = await rowsOf(ada.userId);
    expect(filed.map((row) => row.field)).toHaveLength(2);
    expect(filed.map((row) => row.field)).toEqual(
      expect.arrayContaining(["water", "link"]),
    );
  });
});

describe("how many a runner may file", () => {
  it("refuses a runner's corrections past the day's, in the sheet's words", async () => {
    const runner = await makeUser();
    const filings: { productId: string; garmentId: string }[] = [];
    for (let index = 0; index <= CORRECTIONS_PER_DAY; index += 1) {
      const { productId } = await product(`Layer ${String(index)}`);
      const garmentId = await makeItem({ userId: runner, category: "top" });
      await core()
        .update(wardrobeItems)
        .set({ productId })
        .where(eq(wardrobeItems.id, garmentId));
      filings.push({ productId, garmentId });
    }
    const last = filings.pop();
    if (last === undefined) throw new Error("no filings");
    for (const filing of filings) {
      await file(
        { userId: runner, garmentId: filing.garmentId },
        filing.productId,
        "name",
        "Better",
      );
    }

    const filing = file(
      { userId: runner, garmentId: last.garmentId },
      last.productId,
      "name",
      "Better",
    );

    await expect(filing).rejects.toSatisfy(
      (error: unknown) =>
        controlRefusalMessage(error) === CORRECTION_LIMIT_REACHED,
    );
    expect(CORRECTION_LIMIT_REACHED).toBe(
      "That's 20 corrections today. You can send more tomorrow.",
    );
    expect(await rowsOf(runner)).toHaveLength(CORRECTIONS_PER_DAY);
  });

  it("does not count a repeat of the same key, or a filing refused before it", async () => {
    const { productId } = await product();
    const who = await owner(productId);
    const key = newUlid();
    for (let index = 0; index < CORRECTIONS_PER_DAY; index += 1) {
      await file(who, productId, "name", "Better", { idempotencyKey: key });
      await expect(
        file(
          { userId: who.userId, garmentId: newUlid() },
          productId,
          "name",
          "Better",
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    }

    await file(who, productId, "weight", "light");

    expect(await rowsOf(who.userId)).toHaveLength(2);
  });
});

describe("a closed account's corrections", () => {
  it("leave the queue, its count and its filers, and come back if it is reopened", async () => {
    const { productId } = await product();
    const closed = await owner(productId, "closed_one");
    const open = await owner(productId, "open_one");
    await file(closed, productId, "weight", "light");
    await file(open, productId, "weight", "light");
    await file(closed, productId, "name", "Other");

    await core()
      .update(userProfiles)
      .set({ bannedAt: 1 })
      .where(eq(userProfiles.userId, closed.userId));
    const queue = await correctionsQueue();

    expect(queue.waiting).toBe(1);
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]?.filers.map((filer) => filer.handle)).toStrictEqual([
      "open_one",
    ]);
    expect(await waitingCorrectionsCountOf(core())).toStrictEqual([
      { rows: 1 },
    ]);

    await core()
      .update(userProfiles)
      .set({ bannedAt: orSqlNull(undefined) })
      .where(eq(userProfiles.userId, closed.userId));
    const reopened = await correctionsQueue();
    expect(reopened.waiting).toBe(2);
  });
});

describe("the sheet's context (R48·129)", () => {
  it("names the product, says what it says now, and lists the runner's own waiting", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    const bo = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(bo, productId, "fabric", "merino");
    const context = await correctionContext(ada.userId, productId);
    expect(context.brandName).toBe("Janji");
    expect(context.productName).toBe("AFO Middle Layer");
    expect(context.current).toStrictEqual({
      name: "AFO Middle Layer",
      weight: "mid",
      fabric: "synthetic",
      wind: "yes",
    });
    expect(context.waiting).toHaveLength(1);
    expect(context.waiting[0]).toMatchObject({
      field: "weight",
      value: "light",
    });
  });

  it("quotes a shared product's link by its domain, never the pasted URL (SA-L02)", async () => {
    const { productId } = await product();
    await core()
      .update(products)
      .set({ sourceUrl: "https://www.shop.example/p/123?ref=private-token" })
      .where(eq(products.id, productId));
    const ada = await owner(productId);

    const context = await correctionContext(ada.userId, productId);

    expect(context.current.link).toBe("shop.example");
    expect(JSON.stringify(context)).not.toContain("private-token");
  });

  it("quotes no link at all when its domain is denied", async () => {
    const { productId } = await product();
    await core()
      .update(products)
      .set({ sourceUrl: "https://bit.ly/x" })
      .where(eq(products.id, productId));
    await core()
      .insert(domainDenylist)
      .values({ domain: "bit.ly", addedBy: "test", createdAt: 1 })
      .onConflictDoNothing();
    const ada = await owner(productId);

    const context = await correctionContext(ada.userId, productId);

    expect(context.current).not.toHaveProperty("link");
  });

  it("is not found for a product that does not exist", async () => {
    const ada = await makeUser();
    const context = correctionContext(ada, newUlid());
    await expect(context).rejects.toBeInstanceOf(NotFoundError);
    await expect(context).rejects.toThrow("Product not found.");
  });
});

const at = (iso: string) => Date.parse(iso) / 1000;

async function decideAt(userId: string, decidedAt: number): Promise<void> {
  await core()
    .update(productCorrections)
    .set({ status: "declined", decidedBy: "op", decidedAt })
    .where(eq(productCorrections.userId, userId));
}

describe("the Desk's queue (R48·130)", () => {
  it("loads a page of a hundred different products (SA-M37)", async () => {
    let runner = await makeUser();
    for (let index = 0; index < CORRECTIONS_PAGE; index += 1) {
      // A new runner each day's worth, so no filing is past the limit.
      if (index > 0 && index % CORRECTIONS_PER_DAY === 0) {
        runner = await makeUser();
      }
      const { productId } = await product(`Layer ${String(index)}`);
      const garmentId = await makeItem({ userId: runner, category: "top" });
      await core()
        .update(wardrobeItems)
        .set({ productId })
        .where(eq(wardrobeItems.id, garmentId));
      await file({ userId: runner, garmentId }, productId, "name", "Better");
    }
    const queue = await correctionsQueue();
    expect(queue.groups).toHaveLength(CORRECTIONS_PAGE);
    expect(queue.groups.every((group) => group.filers.length === 1)).toBe(true);
  });

  it("groups by product, field and value, most runners first, then oldest", async () => {
    const { productId } = await product();
    const [ada, bo, cy] = [
      await owner(productId, "ada"),
      await owner(productId, "bo"),
      await owner(productId, "cy"),
    ];
    await file(ada, productId, "weight", "light", { note: "maker's page" });
    await file(bo, productId, "weight", "light");
    await file(cy, productId, "weight", "heavy");
    const queue = await correctionsQueue();
    expect(queue.waiting).toBe(2);
    expect(queue.decidedToday).toBe(0);
    expect(
      queue.groups.map((group) => [group.value, group.filers.length]),
    ).toStrictEqual([
      ["light", 2],
      ["heavy", 1],
    ]);
    const [light] = queue.groups;
    expect(light).toMatchObject({
      brandName: "Janji",
      productName: "AFO Middle Layer",
      field: "weight",
      now: "mid",
    });
    const handles = light?.filers.map((filer) => filer.handle ?? "");
    const ordered = handles?.toSorted((left, right) =>
      left.localeCompare(right),
    );
    expect(ordered).toStrictEqual(["ada", "bo"]);
    expect(light?.filers.find((filer) => filer.handle === "ada")?.note).toBe(
      "maker's page",
    );
  });

  it("puts the oldest first among rows with as many runners", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    const bo = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(bo, productId, "fabric", "merino");
    await core()
      .update(productCorrections)
      .set({ createdAt: 5 })
      .where(eq(productCorrections.userId, bo.userId));
    const queue = await correctionsQueue();
    expect(queue.groups.map((group) => group.field)).toStrictEqual([
      "fabric",
      "weight",
    ]);
    expect(queue.groups[0]?.firstAt).toBe(5);
  });

  it("lists the newest filer first", async () => {
    const { productId } = await product();
    const ada = await owner(productId, "ada");
    const bo = await owner(productId, "bo");
    await file(ada, productId, "weight", "light");
    await file(bo, productId, "weight", "light");
    await core()
      .update(productCorrections)
      .set({ createdAt: 5 })
      .where(eq(productCorrections.userId, ada.userId));
    const queue = await correctionsQueue();
    const [group] = queue.groups;
    expect(group?.filers.map((filer) => filer.handle)).toStrictEqual([
      "bo",
      "ada",
    ]);
  });

  it("says nothing for a fact the product does not state", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "water", "yes");
    const queue = await correctionsQueue();
    const [group] = queue.groups;
    expect(group?.now).toBeUndefined();
  });

  it("is empty with nothing waiting, and the count is zero", async () => {
    const queue = await correctionsQueue();
    expect(queue).toStrictEqual({ groups: [], waiting: 0, decidedToday: 0 });
    expect(await waitingCorrectionsCountOf(core())).toStrictEqual([]);
  });

  it("counts rows on the rail, not runners", async () => {
    const { productId } = await product();
    await file(await owner(productId), productId, "weight", "light");
    await file(await owner(productId), productId, "weight", "light");
    await file(await owner(productId), productId, "name", "AFO Mid Layer");
    expect(await waitingCorrectionsCountOf(core())).toStrictEqual([
      { rows: 1 },
      { rows: 1 },
    ]);
  });

  it("gives each row only its own runners: same product and field and value", async () => {
    const afo = await product();
    const rover = await product("Rover Half-Zip");
    const ada = await owner(afo.productId, "ada");
    const bo = await owner(afo.productId, "bo");
    const cy = await owner(afo.productId, "cy");
    const di = await owner(rover.productId, "di");
    await file(ada, afo.productId, "weight", "light");
    await file(bo, afo.productId, "water", "yes");
    await file(cy, afo.productId, "wind", "yes");
    await file(di, rover.productId, "weight", "light");
    const queue = await correctionsQueue();
    const rows = queue.groups.map((group) => [
      group.productName,
      group.field,
      group.filers.map((filer) => filer.handle),
    ]);
    const ordered = rows.toSorted((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
    expect(ordered).toStrictEqual([
      ["AFO Middle Layer", "water", ["bo"]],
      ["AFO Middle Layer", "weight", ["ada"]],
      ["AFO Middle Layer", "wind", ["cy"]],
      ["Rover Half-Zip", "weight", ["di"]],
    ]);
  });

  describe("decided today", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-07T15:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("counts rows decided since midnight UTC, and none from yesterday", async () => {
      const { productId } = await product();
      const early = await owner(productId);
      const yesterday = await owner(productId);
      await file(early, productId, "weight", "light");
      await file(yesterday, productId, "fabric", "merino");
      await decideAt(early.userId, at("2026-11-07T00:01:00Z"));
      await decideAt(yesterday.userId, at("2026-11-06T23:59:00Z"));
      const queue = await correctionsQueue();
      expect(queue.decidedToday).toBe(1);
    });
  });

  it("shows a page of rows", () => {
    expect(CORRECTIONS_PAGE).toBe(100);
  });
});

const weightLight = (productId: string): CorrectionKey => ({
  productId,
  field: "weight",
  value: "light",
});

describe("Apply (R48·130)", () => {
  it("decides a field a hundred runners filed on (SA-M37)", async () => {
    const { productId } = await product();
    const filers = [];
    for (let index = 0; index < 100; index += 1) {
      const who = await owner(productId);
      await file(who, productId, "weight", "light");
      filers.push(who);
    }
    expect(
      await applyCorrection({ actorId: "op", key: weightLight(productId) }),
    ).toStrictEqual({ outcome: "applied" });
    const waiting = await core()
      .select({ id: productCorrections.id })
      .from(productCorrections)
      .where(eq(productCorrections.status, "waiting"));
    expect(waiting).toStrictEqual([]);
    expect(await bellOf(filers[99]?.userId ?? "")).toHaveLength(1);
  });

  it("writes nothing for a value no runner is waiting on (SA-L11)", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "link", "https://example.com/shoe");
    expect(
      await applyCorrection({
        actorId: "op",
        key: { productId, field: "link", value: "https://example.com/other" },
      }),
    ).toStrictEqual({ outcome: "changed" });
    const productAfter = await productRow(productId);
    expect(productAfter.sourceUrl).toBe(NOTHING);
    const [row] = await rowsOf(ada.userId);
    expect(row?.status).toBe("waiting");
    expect(await bellOf(ada.userId)).toStrictEqual([]);
  });

  it("writes nothing once the runner has filed again (SA-L11)", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(ada, productId, "weight", "heavy");
    expect(
      await applyCorrection({ actorId: "op", key: weightLight(productId) }),
    ).toStrictEqual({ outcome: "changed" });
    const unchanged = await productRow(productId);
    expect(unchanged.weight).toBe("mid");
  });

  it("writes the product, decides every waiting row for the field, and rings each runner", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    const bo = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(bo, productId, "weight", "heavy");
    expect(
      await applyCorrection({ actorId: "op", key: weightLight(productId) }),
    ).toStrictEqual({ outcome: "applied" });
    const applied = await productRow(productId);
    expect(applied.weight).toBe("light");
    for (const who of [ada, bo]) {
      const [row] = await rowsOf(who.userId);
      expect(row).toMatchObject({
        status: "applied",
        decidedBy: "op",
        reason: NOTHING,
      });
      expect(row?.decidedAt).toBeTypeOf("number");
      const [bell] = await bellOf(who.userId);
      expect(bell).toMatchObject({
        kind: "correction_applied",
        subjectId: row?.id,
        linkId: who.garmentId,
        body: "We fixed the weight on AFO Middle Layer. Thanks.",
        read: false,
      });
    }
    const queue = await correctionsQueue();
    expect(queue.groups).toHaveLength(0);
    expect(queue.decidedToday).toBe(2);
  });

  it("leaves another field's rows waiting", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(ada, productId, "water", "yes");
    await applyCorrection({ actorId: "op", key: weightLight(productId) });
    const rows = await rowsOf(ada.userId);
    const statuses = rows.map((row) => [row.field, row.status]);
    expect(statuses).toContainEqual(["water", "waiting"]);
  });

  it("names the product by its corrected name", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "name", "AFO Mid Layer");
    await applyCorrection({
      actorId: "op",
      key: { productId, field: "name", value: "AFO Mid Layer" },
    });
    const row = await productRow(productId);
    expect(row.name).toBe("AFO Mid Layer");
    expect(row.normalizedName).toBe("afo mid layer");
    const [bell] = await bellOf(ada.userId);
    expect(bell?.body).toBe("We fixed the name on AFO Mid Layer. Thanks.");
  });

  it("refuses a name another product of the brand has, and changes nothing", async () => {
    const { productId } = await product();
    await product("Rover Half-Zip");
    const ada = await owner(productId);
    await file(ada, productId, "name", "rover  half-zip");
    expect(
      await applyCorrection({
        actorId: "op",
        key: { productId, field: "name", value: "rover  half-zip" },
      }),
    ).toStrictEqual({ outcome: "name_taken" });
    const kept = await productRow(productId);
    expect(kept.name).toBe("AFO Middle Layer");
    const rows = await rowsOf(ada.userId);
    expect(rows[0]?.status).toBe("waiting");
    expect(await bellOf(ada.userId)).toHaveLength(0);
  });

  it("allows a name that only differs from the product's own", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "name", "afo middle layer");
    expect(
      await applyCorrection({
        actorId: "op",
        key: { productId, field: "name", value: "afo middle layer" },
      }),
    ).toStrictEqual({ outcome: "applied" });
  });

  it("is a repeat with nothing done once nobody is waiting", async () => {
    const { productId } = await product();
    expect(
      await applyCorrection({ actorId: "op", key: weightLight(productId) }),
    ).toStrictEqual({ outcome: "applied" });
    const unchanged = await productRow(productId);
    expect(unchanged.weight).toBe("mid");
  });

  it("is not found for a product that does not exist", async () => {
    const key = weightLight(newUlid());
    const applied = applyCorrection({ actorId: "op", key });
    await expect(applied).rejects.toBeInstanceOf(NotFoundError);
    await expect(applied).rejects.toThrow("Product not found.");
  });
});

describe("Decline (R48·130)", () => {
  it("keeps the product, decides only the row's own value, and rings with the reason", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    const bo = await owner(productId);
    await file(ada, productId, "weight", "light");
    await file(bo, productId, "weight", "heavy");
    await declineCorrection({
      actorId: "op",
      key: weightLight(productId),
      reason: "maker_says_otherwise",
    });
    const kept = await productRow(productId);
    expect(kept.weight).toBe("mid");
    const [declined] = await rowsOf(ada.userId);
    expect(declined).toMatchObject({
      status: "declined",
      decidedBy: "op",
      reason: "The maker's page says otherwise",
    });
    const boRows = await rowsOf(bo.userId);
    expect(boRows[0]?.status).toBe("waiting");
    const [bell] = await bellOf(ada.userId);
    expect(bell).toMatchObject({
      kind: "correction_declined",
      subjectId: declined?.id,
      linkId: ada.garmentId,
      body: "We kept the weight on AFO Middle Layer as it is.\nThe maker's page says otherwise",
    });
    expect(await bellOf(bo.userId)).toHaveLength(0);
  });

  it("sends no second line for no reason given", async () => {
    const { productId } = await product();
    const ada = await owner(productId);
    await file(ada, productId, "wind", "no");
    await declineCorrection({
      actorId: "op",
      key: { productId, field: "wind", value: "no" },
      reason: "none",
    });
    const rows = await rowsOf(ada.userId);
    expect(rows[0]?.reason).toBeNull();
    const bell = await bellOf(ada.userId);
    expect(bell[0]?.body).toBe(
      "We kept the wind resistance on AFO Middle Layer as it is.",
    );
  });

  it("does nothing once nobody is waiting", async () => {
    const { productId } = await product();
    await declineCorrection({
      actorId: "op",
      key: weightLight(productId),
      reason: "not_enough",
    });
    expect(await correctionsQueue()).toMatchObject({ decidedToday: 0 });
  });
});
