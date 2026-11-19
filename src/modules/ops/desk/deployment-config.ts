/**
 * Every var and secret a production deployment sets, by name (#824,
 * design 237): the code's copy of `docs/launch/deployment-plan.md` §2,
 * held against it by `test/ops/deployment-config.node.test.ts` both ways,
 * name, kind and level, so a value added to one cannot be missing from the
 * other.
 *
 * `/api/health` shows an operator each one as set or missing, never its
 * value. The daily digest names each missing one whose level asks for it
 * (`isNamedByDigest`).
 *
 * Pure, importing nothing: the pin test runs in Node, which cannot load
 * `src/env`.
 */

/**
 * The plan's "required" column, word for word.
 */
export const configNeeds = [
  "yes",
  "strongly",
  "before friends",
  "before public",
  "for Strava",
  "owner only",
  "optional",
] as const;

export type ConfigNeed = (typeof configNeeds)[number];

const configKinds = ["var", "secret"] as const;

export interface DeploymentValue {
  readonly name: keyof Cloudflare.Env;
  readonly kind: (typeof configKinds)[number];
  readonly need: ConfigNeed;
  /**
   * Missing, `/api/health` answers 503 (`FAILS_HEALTH`).
   */
  readonly failsHealth: boolean;
  /**
   * The digest never names it missing (`DIGEST_CANNOT_REPORT`).
   */
  readonly digestCannotReport: boolean;
}

type Name = keyof Cloudflare.Env;

/**
 * §2's names by level, then kind. Grouped rather than one object per
 * row so a level reads as one line of the plan's checklist.
 */
const BY_NEED: Readonly<
  Record<ConfigNeed, Readonly<Partial<Record<DeploymentValue["kind"], Name[]>>>>
> = {
  yes: {
    var: ["BETTER_AUTH_URL", "TURNSTILE_SITE_KEY"],
    secret: [
      "BETTER_AUTH_SECRET",
      "VISUAL_CROSSING_API_KEY",
      "OPENAI_API_KEY",
      "ADMIN_USER_IDS",
      "TURNSTILE_SECRET_KEY",
    ],
  },
  strongly: {
    var: ["CF_ACCOUNT_ID"],
    secret: ["SENTRY_DSN", "ANALYTICS_SQL_TOKEN"],
  },
  "before friends": {
    secret: [
      "UNSUBSCRIBE_SECRET",
      "CLOSED_ADDRESS_SECRET",
      "MODERATION_THRESHOLDS",
    ],
  },
  "before public": { secret: ["TAKEDOWN_SECRET"] },
  "for Strava": {
    var: ["STRAVA_SUBSCRIPTION_ID"],
    secret: [
      "STRAVA_CLIENT_ID",
      "STRAVA_CLIENT_SECRET",
      "STRAVA_WEBHOOK_VERIFY_TOKEN",
      "STRAVA_WEBHOOK_PATH_SECRET",
    ],
  },
  "owner only": { secret: ["GARMIN_API_KEY", "GARMIN_OWNER_USER_ID"] },
  optional: {
    secret: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FIRECRAWL_API_KEY"],
  },
};

/**
 * The three `/api/health` has always failed on (OPS-4, task 126,
 * `createAuth`). The rest are absent in dev and CI's e2e, which must stay
 * healthy without production keys.
 */
const FAILS_HEALTH: ReadonlySet<Name> = new Set<Name>([
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "UNSUBSCRIBE_SECRET",
]);

/**
 * The digest's findings travel by Sentry, so without its DSN a line
 * saying so would go nowhere. Health's operator report still shows it.
 */
const DIGEST_CANNOT_REPORT: ReadonlySet<Name> = new Set<Name>(["SENTRY_DSN"]);

export const deploymentConfig: readonly DeploymentValue[] = configNeeds.flatMap(
  (need) =>
    configKinds.flatMap((kind) =>
      (BY_NEED[need][kind] ?? []).map((name) => ({
        name,
        kind,
        need,
        failsHealth: FAILS_HEALTH.has(name),
        digestCannotReport: DIGEST_CANNOT_REPORT.has(name),
      })),
    ),
);

/**
 * The levels whose absence the digest reports every morning (owner,
 * 2026-11-17). The rest are unset on purpose until their feature is
 * wanted, and a daily alert for them would be noise.
 */
const NAMED_BY_DIGEST: ReadonlySet<ConfigNeed> = new Set<ConfigNeed>([
  "yes",
  "strongly",
  "before friends",
  "before public",
]);

export function isNamedByDigest(value: DeploymentValue): boolean {
  return !value.digestCannotReport && NAMED_BY_DIGEST.has(value.need);
}
