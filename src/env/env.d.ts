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
    // Strava OAuth + webhook (lane 102). Credentials don't exist yet — the
    // connect/webhook path degrades to a no-op until a human sets these via
    // `wrangler secret` (CLAUDE.md law 5).
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
    STRAVA_WEBHOOK_VERIFY_TOKEN?: string;
  }
}
