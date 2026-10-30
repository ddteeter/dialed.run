import { inArray } from "drizzle-orm";

import { cronCheckpoints } from "../../db/schema-core";
import { coreDb, env } from "../../env";
import { nowSeconds } from "../../lib/now";
import { cronPeriods, type CronName } from "./crons";

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
  at: number;
}

/**
 * Vars a production deployment cannot do without, which a binding check
 * would never notice. `BETTER_AUTH_URL` decides where Better Auth sends
 * callbacks and whether its cookies carry the `__Secure-` prefix (audit
 * finding 0.7); unset, auth half-works, which is worse than not at all.
 * `UNSUBSCRIBE_SECRET` signs unsubscribe links; unset, no optional email
 * goes and every link is refused (task 126, fail closed).
 */
const REQUIRED_CONFIG = ["BETTER_AUTH_URL", "UNSUBSCRIBE_SECRET"] as const;

function missingConfig(): string[] {
  return REQUIRED_CONFIG.filter((name) => {
    const value: unknown = env[name];
    return typeof value !== "string" || value === "";
  });
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
    at,
  };
}
