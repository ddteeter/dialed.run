import { env } from "../../env";
import { nowSeconds } from "../../lib/now";

export interface HealthReport {
  ok: boolean;
  checks: Record<string, "ok" | "failed">;
  /**
   * Configuration the deployment needs and does not have, by its own name,
   * so the fix is in the answer (OPS-4). Empty when nothing is missing.
   */
  missing: readonly string[];
  at: number;
}

/**
 * Vars a production deployment cannot do without, which a binding check
 * would never notice. `BETTER_AUTH_URL` decides where Better Auth sends
 * callbacks and whether its cookies carry the `__Secure-` prefix (audit
 * finding 0.7); unset, auth half-works, which is worse than not at all.
 */
const REQUIRED_CONFIG = ["BETTER_AUTH_URL"] as const;

function missingConfig(): string[] {
  return REQUIRED_CONFIG.filter((name) => {
    const value: unknown = env[name];
    return typeof value !== "string" || value === "";
  });
}

/**
/health backing (000 §10): D1 SELECT 1 on both DBs, R2 head, and the
required configuration by name.
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
  return {
    ok: Object.values(checks).every((c) => c === "ok") && missing.length === 0,
    checks,
    missing,
    at: nowSeconds(),
  };
}
