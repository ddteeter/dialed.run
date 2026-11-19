import { inArray } from "drizzle-orm";

import { cronCheckpoints } from "../../../db/schema-core";
import { coreDb, env } from "../../../env";
import { nowSeconds } from "../../../lib/now";
import { cronPeriods, type CronName } from "./crons";
import { isOperator } from "./desk";
import {
  deploymentConfig,
  isNamedByDigest,
  type DeploymentValue,
} from "./deployment-config";

export interface HealthReport {
  ok: boolean;
  checks: Record<string, "ok" | "failed">;
  /**
   * Configuration the deployment needs and does not have, by its own name,
   * so the fix is in the answer (OPS-4). Empty when nothing is missing.
   */
  missing: readonly string[];
  /**
   * Crons that have not run for two of their periods, by name (design
   * 162). Sentry's free plan watches one cron, so this is how the uptime
   * check notices any of the others stopping. A cron that has never run
   * is not stale: a fresh deployment, dev and CI have no heartbeat rows.
   */
  staleCrons: readonly CronName[];
  /**
   * The Worker version that answered (`CF_VERSION_METADATA`), so a
   * deploy's smoke test can tell that its version override reached the
   * version it uploaded: an override Cloudflare does not apply falls back
   * to the deployment's split without saying so (design 186).
   */
  version: string;
  at: number;
  /**
   * Every value `docs/launch/deployment-plan.md` §2 names, set or missing
   * (design 237), by name and never by value.
   */
  config: Record<string, "set" | "missing">;
}

/**
 * What anyone may read (owner, 2026-11-17): the uptime monitor needs only
 * the status, and the deploy smoke test `ok` and `version`.
 */
export type PublicHealth = Pick<HealthReport, "ok" | "version" | "at">;

function isSet(name: DeploymentValue["name"]): boolean {
  const value: unknown = env[name];
  return typeof value === "string" && value !== "";
}

/**
 * Every deployment value, set or missing (design 237): the name only,
 * never what it is set to.
 */
function configStatus(): Record<string, "set" | "missing"> {
  return Object.fromEntries(
    deploymentConfig.map((value) => [
      value.name,
      isSet(value.name) ? "set" : "missing",
    ]),
  );
}

/**
 * The missing values a production deployment cannot do without, which a
 * binding check would never notice (`failsHealth`, `deployment-config.ts`).
 */
function missingConfig(): string[] {
  return deploymentConfig
    .filter((value) => value.failsHealth && !isSet(value.name))
    .map((value) => value.name);
}

/**
 * The digest's `config` lines (design 237): each missing value whose
 * level the digest reports, with that level, so the morning says which
 * deploy step was missed.
 */
export function checkDeploymentConfig(anomalies: string[]): void {
  for (const value of deploymentConfig) {
    if (isNamedByDigest(value) && !isSet(value.name)) {
      anomalies.push(
        `${value.name} is not set (deployment plan §2: ${value.need})`,
      );
    }
  }
}

/**
 * The crons whose heartbeat is older than two periods: one late or missed
 * firing is tolerated, two in a row is a cron that has stopped. Empty when
 * the read fails, which the core database check reports already.
 */
async function staleCrons(now: number): Promise<CronName[]> {
  try {
    const rows = await coreDb()
      .select({
        name: cronCheckpoints.cronName,
        lastRunAt: cronCheckpoints.lastRunAt,
      })
      .from(cronCheckpoints)
      .where(
        inArray(
          cronCheckpoints.cronName,
          cronPeriods.map((cron) => cron.name),
        ),
      );
    const lastRun = new Map(rows.map((row) => [row.name, row.lastRunAt]));
    return cronPeriods
      .filter((cron) => {
        // Never run reads as just run: a fresh deployment is not stale.
        const last = lastRun.get(cron.name) ?? now;
        return now - last > 2 * cron.periodS;
      })
      .map((cron) => cron.name);
  } catch {
    return [];
  }
}

/**
/health backing (000 §10): D1 SELECT 1 on both DBs, R2 head, the required
configuration by name, and crons that have stopped (design 162).
*/
export async function checkHealth(): Promise<HealthReport> {
  const checks: HealthReport["checks"] = {
    coreDb: "failed",
    weatherDb: "failed",
    media: "failed",
  };
  try {
    await env.DIALED_CORE.prepare("SELECT 1").first();
    checks.coreDb = "ok";
  } catch {
    /*
    reported via ok:false
    */
  }
  try {
    await env.DIALED_WEATHER.prepare("SELECT 1").first();
    checks.weatherDb = "ok";
  } catch {
    /*
    reported via ok:false
    */
  }
  try {
    // Equivalent mutant: the key is arbitrary. This asks R2 whether an
    // object exists, and a miss is a successful round trip — which is the
    // whole check. Any string, including an empty one, proves the same
    // thing, so no assertion can tell them apart.
    // Stryker disable next-line StringLiteral
    await env.MEDIA.head("health-probe");
    checks.media = "ok";
  } catch {
    /*
    reported via ok:false
    */
  }
  const missing = missingConfig();
  const at = nowSeconds();
  const stale = await staleCrons(at);
  return {
    ok:
      Object.values(checks).every((c) => c === "ok") &&
      missing.length === 0 &&
      stale.length === 0,
    checks,
    missing,
    staleCrons: stale,
    version: env.CF_VERSION_METADATA.id,
    at,
    config: configStatus(),
  };
}

/**
 * `/api/health`'s answer, 200 when healthy and 503 when not, for anyone.
 * Only an operator (the Desk's question, `isOperator`) is told why: the
 * checks, the missing configuration, the stopped crons and every
 * deployment value's line. A stranger gets `ok`, `version` and `at`.
 */
export async function healthResponse(viewerId: string): Promise<Response> {
  const report = await checkHealth();
  const status = report.ok ? 200 : 503;
  if (isOperator(viewerId)) return Response.json(report, { status });
  const answer: PublicHealth = {
    ok: report.ok,
    version: report.version,
    at: report.at,
  };
  return Response.json(answer, { status });
}
