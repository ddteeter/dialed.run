/**
 * Secrets are set via `wrangler secret` in production and .dev.vars
 * locally, so `wrangler types` cannot see them — they are declared here.
 * Optional: code must degrade when absent (CLAUDE.md law 5).
 */
declare namespace Cloudflare {
  interface Env {
    SENTRY_DSN?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    /** Visual Crossing Timeline API key (000/103) — does not exist yet;
     * modules/weather degrades to `weather_pending` while absent. */
    VISUAL_CROSSING_API_KEY?: string;
  }
}
