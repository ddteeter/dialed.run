import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { takedownBlocks, takedownRequests } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  takedownBlocksListed,
  unblockTakedownKey,
} from "../../src/modules/safety/takedowns/takedown-blocks";
import {
  blockAndDeclineAll,
  fileTakedownRequest,
} from "../../src/modules/safety/takedowns/takedown-requests";
import { oweInCoreWhere } from "../../src/modules/ops/outbox/owe-in-core";
import { noPurge } from "../purge-spy";

import { resetSafetyTables } from "./helpers";

/**
 * The Desk's blocks on `/takedown` (design 137): listed with what an
 * operator can recognise each by, and lifted by Unblock.
 */
const NOW = 1_800_000_000;
const SECRET = "test-takedown-secret";

function core() {
  return drizzle(env.DIALED_CORE);
}

async function file(
  email: string,
  location: string,
  options: { ip?: string; now?: number } = {},
) {
  await fileTakedownRequest(
    core(),
    {
      email,
      signature: "Sam Runner",
      location,
      description: "",
      isAttested: true,
      idempotencyKey: newUlid(),
      attempt: "token",
      remoteIp: options.ip ?? "203.0.113.9",
      isLimited: false,
    },
    {
      verify: () => Promise.resolve({ ok: true }),
      oweWhere: oweInCoreWhere,
      purge: noPurge,
      secret: SECRET,
    },
    options.now ?? NOW,
  );
  const [row] = await core()
    .select()
    .from(takedownRequests)
    .where(eq(takedownRequests.location, location));
  if (row === undefined) throw new Error("no request filed");
  return row;
}

async function confirmedBlock(email: string, location: string) {
  const row = await file(email, location);
  await core()
    .update(takedownRequests)
    .set({ confirmedAt: NOW - 5 })
    .where(eq(takedownRequests.id, row.id));
  await blockAndDeclineAll(core(), "op-one", row.id, NOW);
  return row;
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(takedownRequests);
  await core().delete(takedownBlocks);
});

describe("the blocks Review lists", () => {
  it("are newest first, an address by itself and a network by the address it was blocked from", async () => {
    const older = await confirmedBlock("Old+x@example.com", "elsewhere-1");
    await file("new@example.com", "elsewhere-2", { ip: "198.51.100.7" });
    const [newer] = await core()
      .select()
      .from(takedownRequests)
      .where(eq(takedownRequests.location, "elsewhere-2"));
    if (newer === undefined) throw new Error("no request filed");
    await blockAndDeclineAll(core(), "op-two", newer.id, NOW + 60);

    expect(await takedownBlocksListed(core())).toStrictEqual([
      {
        key: newer.ipKey,
        kind: "ip",
        createdAt: NOW + 60,
        address: "new@example.com",
      },
      {
        key: "old@example.com",
        kind: "email",
        createdAt: NOW,
        address: "old@example.com",
      },
      {
        key: older.ipKey,
        kind: "ip",
        createdAt: NOW,
        address: "old+x@example.com",
      },
    ]);
  });

  it("name no address for a network whose request is gone", async () => {
    const row = await confirmedBlock("me@example.com", "elsewhere");
    await core().delete(takedownRequests);
    const listed = await takedownBlocksListed(core());
    expect(listed.find((block) => block.kind === "ip")).toStrictEqual({
      key: row.ipKey,
      kind: "ip",
      createdAt: NOW,
      address: undefined,
    });
  });

  it("are at most `limit`", async () => {
    for (let index = 0; index < 3; index += 1) {
      await core()
        .insert(takedownBlocks)
        .values({
          key: `k${String(index)}@example.com`,
          kind: "email",
          createdAt: NOW + index,
          createdBy: "op-one",
        });
    }
    const listed = await takedownBlocksListed(core(), 2);
    expect(listed.map((block) => block.key)).toStrictEqual([
      "k2@example.com",
      "k1@example.com",
    ]);
  });
});

describe("Unblock", () => {
  it("lifts the block, so what that address files next hides as usual", async () => {
    await confirmedBlock("me@example.com", "elsewhere");
    const blocked = await file("me@example.com", "https://dialed.run/x/1", {
      ip: "198.51.100.7",
      now: NOW + 10,
    });
    expect(blocked.holdState).toBe("blocked");

    expect(await unblockTakedownKey(core(), "me@example.com")).toBe(
      "unblocked",
    );
    const blocks = await core().select().from(takedownBlocks);
    expect(blocks.map((block) => block.kind)).toStrictEqual(["ip"]);
    const next = await file("me@example.com", "https://dialed.run/x/2", {
      ip: "198.51.100.7",
      now: NOW + 20,
    });
    expect(next.holdState).not.toBe("blocked");
  });

  it("says a block already lifted is not found", async () => {
    expect(await unblockTakedownKey(core(), "nobody@example.com")).toBe(
      "not_found",
    );
  });
});
