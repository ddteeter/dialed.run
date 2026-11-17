import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  GLOBAL_SUBJECT,
  RATE_LIMIT_KINDS,
  SEND_LIMIT_KINDS,
} from "../../src/lib/contracts/rate-limits";
import { newUlid } from "../../src/lib/ids";
import {
  claimLimit,
  claimRunnerChange,
  claimSignInTry,
  countSend,
} from "../../src/modules/email";
import {
  canSpendPageFetch,
  canSpendProxyCall,
  canSpendRunnerRequest,
} from "../../src/modules/enrichment/spend-limit";
import { cspReportDepsFromEnv } from "../../src/modules/ops/csp-report";
import { isWithinUploadCap } from "../../src/modules/runs/imports";
import {
  isWithinAtOnceLimit,
  isWithinReportLimit,
} from "../../src/modules/safety/reportable";
import { runnerWeatherBudget } from "../../src/modules/weather/budget";
import { countedKeys } from "../rate-limit-rows";

/**
 * `RATE_LIMIT_KINDS` is the closed set `rate_limits.kind` stores: every
 * count the app makes writes one of them, and every one of them is
 * written by something.
 */

const db = drizzle(env.DIALED_CORE);
const NOW = 1_800_000_000;

beforeEach(async () => {
  await db.delete(rateLimits);
});

describe("the rate-limit kinds", () => {
  it("are exactly the kinds the app counts", async () => {
    const runner = newUlid();
    for (const kind of SEND_LIMIT_KINDS) {
      await countSend(db, kind, "Someone@Example.test", NOW);
    }
    await claimRunnerChange(db, runner, NOW);
    await canSpendRunnerRequest(db, runner, NOW);
    await canSpendPageFetch(db, NOW);
    await canSpendProxyCall(db, NOW);
    await claimSignInTry(db, "Someone@Example.test", NOW);
    await cspReportDepsFromEnv().isWithinLimit("203.0.113.9");
    await isWithinUploadCap(db, runner, NOW);
    await isWithinReportLimit(db, runner, NOW);
    await isWithinAtOnceLimit(db, runner, NOW);
    await claimLimit(db, "resend-visitor", "2001:db8:1:2::7", NOW);
    await claimLimit(db, "takedown-to", "someone@example.test", NOW);
    await runnerWeatherBudget(runner)();
    await claimLimit(db, "photo-runner", runner, NOW);

    const keys = await countedKeys(db);
    expect(keys).toStrictEqual(
      [
        ...SEND_LIMIT_KINDS.map((kind) => `${kind}:someone@example.test`),
        `change-runner:${runner}`,
        `enrich-runner:${runner}`,
        `upload-runner:${runner}`,
        `page-fetch:${GLOBAL_SUBJECT}`,
        `proxy-call:${GLOBAL_SUBJECT}`,
        "sign-in:someone@example.test",
        "csp-report:203.0.113.9",
        `report-runner:${runner}`,
        `report-at-once:${runner}`,
        "resend-visitor:2001:db8:1:2::/64",
        "takedown-to:someone@example.test",
        `weather-runner:${runner}`,
        `photo-runner:${runner}`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
    const kinds = new Set(keys.map((key) => key.slice(0, key.indexOf(":"))));
    expect(kinds).toStrictEqual(new Set(RATE_LIMIT_KINDS));
  });

  it("start with the sends, and count a global spend under one subject", () => {
    expect(RATE_LIMIT_KINDS.slice(0, SEND_LIMIT_KINDS.length)).toStrictEqual([
      ...SEND_LIMIT_KINDS,
    ]);
    expect(SEND_LIMIT_KINDS).toStrictEqual([
      "verify",
      "reset",
      "change",
      "access",
      "takedown",
    ]);
    expect(GLOBAL_SUBJECT).toBe("global");
  });
});
