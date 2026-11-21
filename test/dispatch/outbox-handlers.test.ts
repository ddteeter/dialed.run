/**
 * The dispatch's outbox registry (design 256): each kind bound to the
 * handler its owner exports, and the product link to the linker the
 * firing passes.
 */
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { outboxKinds } from "../../src/lib/sql/outbox";
import { outboxHandlers } from "../../src/modules/dispatch/outbox-handlers";
import { storageHandlers } from "../../src/modules/ops/outbox";
import { owedEmailHandlers } from "../../src/modules/ops/owed-email";
import { manualConditionsHandler } from "../../src/modules/weather";

const db = () => drizzle(env.DIALED_CORE);

describe("the outbox registry", () => {
  it("has a handler for every kind the build drains, and no other", () => {
    const kinds = Object.keys(outboxHandlers(undefined));

    expect(new Set(kinds)).toStrictEqual(new Set(outboxKinds));
  });

  it("binds each kind to the handler its owner exports", () => {
    const registry = outboxHandlers(undefined);

    expect(registry.photo_delete).toBe(storageHandlers.photo_delete);
    expect(registry.entry_media_delete).toBe(
      storageHandlers.entry_media_delete,
    );
    expect(registry.import_file_delete).toBe(
      storageHandlers.import_file_delete,
    );
    expect(registry.import_file_expire).toBe(
      storageHandlers.import_file_expire,
    );
    expect(registry.email).toBe(owedEmailHandlers.email);
    expect(registry.operator_email).toBe(owedEmailHandlers.operator_email);
    expect(registry.manual_conditions_delete).toBe(manualConditionsHandler);
  });

  it("runs the product link through the linker it is given", async () => {
    const link = vi.fn(() => Promise.resolve("linked" as const));

    await outboxHandlers(link).product_link.run(db(), { userId: "u1" }, "row");

    expect(link).toHaveBeenCalledWith(expect.anything(), "u1");
  });

  it("names a deleted run's band by its runner and run (C1)", () => {
    expect(
      manualConditionsHandler.context({ userId: "u1", runId: "r1" }),
    ).toStrictEqual({ userId: "u1", runId: "r1" });
  });
});
