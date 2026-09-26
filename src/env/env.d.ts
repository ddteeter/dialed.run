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
    /** Our Strava push subscription's id (task 127, STR-4), as a string —
     * a var, not a secret; set in the deployment sweep. Every webhook
     * event whose `subscription_id` differs is dropped before the queue,
     * and absent, every event is (fail closed). See
     * `modules/runs/strava/webhook.ts`. */
    STRAVA_SUBSCRIPTION_ID?: string;
    /** Firecrawl key (107) — the proxy fetch for shops that refuse a
     * Worker. Absent: a refusal is recorded as a failed fetch and nothing
     * else happens (law 5). See `modules/enrichment/firecrawl.ts`. */
    FIRECRAWL_API_KEY?: string;
    /** OpenAI key (107) — the LLM extraction rung, the one source of a
     * product's composition. Absent: the ladder stops at the declared
     * rungs and the product has a name and an image but no composition
     * (law 5). Straight to OpenAI rather than through OpenRouter since the
     * PR #72 review; the eval still reads `OPENROUTER_API_KEY` from
     * `.dev.vars`, because it compares several vendors' models. See
     * `modules/enrichment/model/from-env.ts`. */
    /** Admin user ids (106), comma-separated. Absent or empty means NO
     * admins, which fails closed: the review queue becomes unreachable
     * rather than open to everyone. See `modules/safety/admin.ts`. */
    ADMIN_USER_IDS?: string;
    /** OpenAI key (106) — the photo screening classifier
     * (`omni-moderation-latest`). Absent: a photo stays `pending`, so its
     * owner sees it and the public does not, and the screening-retry cron
     * re-drives it once the key exists (law 5). See
     * `modules/safety/classifier/`. */
    OPENAI_API_KEY?: string;
  }
}
