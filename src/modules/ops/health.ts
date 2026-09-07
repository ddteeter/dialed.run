import { env } from "../../env";

export interface HealthReport {
  ok: boolean;
  checks: Record<string, "ok" | "failed">;
  at: number;
}

/**
/health backing (000 §10): D1 SELECT 1 on both DBs, R2 head.
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
    await env.MEDIA.head("health-probe");
    checks.media = "ok";
  } catch {
    /*
    reported via ok:false
    */
  }
  return {
    ok: Object.values(checks).every((c) => c === "ok"),
    checks,
    at: Math.floor(Date.now() / 1000),
  };
}
