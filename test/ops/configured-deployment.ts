import { afterEach, beforeEach } from "vitest";

import { env } from "../../src/env";

/**
 * The deployment values `test/wrangler.test.jsonc` leaves unset, set for
 * every test in the calling file, so a daily digest there is a configured
 * deployment's and its `config` check (design 237) says nothing. The
 * check's own tests are in `test/ops/health.test.ts`.
 *
 * Not `SENTRY_DSN`, which the digest never names, and which would send.
 */
const CONFIGURED = {
  TURNSTILE_SITE_KEY: "test-site-key",
  TURNSTILE_SECRET_KEY: "test-secret-key",
  ADMIN_USER_IDS: "digest-test-operator",
  TAKEDOWN_SECRET: "test-takedown-secret",
  CLOSED_ADDRESS_SECRET: "test-closed-address-secret",
};

export function configuredDeployment(): void {
  const unconfigured: Record<string, unknown> = Object.fromEntries(
    Object.keys(CONFIGURED).map((name) => [name, Reflect.get(env, name)]),
  );
  beforeEach(() => {
    for (const [name, value] of Object.entries(CONFIGURED)) {
      Reflect.set(env, name, value);
    }
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(unconfigured)) {
      Reflect.set(env, name, value);
    }
  });
}
