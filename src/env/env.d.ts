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
    // Strava OAuth + webhook (lane 102). Credentials don't exist yet — the
    // connect/webhook path degrades to a no-op until a human sets these via
    // `wrangler secret` (CLAUDE.md law 5).
    STRAVA_CLIENT_ID?: string;
    STRAVA_CLIENT_SECRET?: string;
    STRAVA_WEBHOOK_VERIFY_TOKEN?: string;
    /** Firecrawl key (107) — the proxy fetch for shops that refuse a
     * Worker. Absent: a refusal is recorded as a failed fetch and nothing
     * else happens (law 5). See `modules/enrichment/firecrawl.ts`. */
    FIRECRAWL_API_KEY?: string;
    /** OpenRouter key (107) — the LLM extraction rung. Absent: the ladder
     * stops at the deterministic rungs, which already answer seven of the
     * eight sampled pages (law 5). See
     * `modules/enrichment/model/from-env.ts`. */
    OPENROUTER_API_KEY?: string;
  }
}
