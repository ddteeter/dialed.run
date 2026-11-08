/**
 * The production smoke test (design 186, #504): one read-only spec run by
 * the deploy job against a Worker version it has uploaded and deployed at
 * 0%, before any runner is routed to it.
 *
 * Its own config, not a project of `playwright.config.ts`, because that
 * config starts a local server for every project and this one must never
 * have one: the server is production. Nothing in CI's e2e jobs reads this
 * file, and its spec's `.smoke.ts` name is outside their match.
 *
 * Every request carries Cloudflare's version override, so it reaches the
 * new version while the deployment's split still sends everyone else to
 * the old one. The override works only for a version that is in the
 * current deployment, a 0% share included:
 * https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/
 */
import { defineConfig } from "@playwright/test";

import { smokeTarget } from "./e2e/smoke/target";

const target = smokeTarget(process.env);

export default defineConfig({
  testDir: "e2e/smoke",
  testMatch: "*.smoke.ts",
  // Production, so no retries that could mask a flaky first deploy, and one
  // worker: the spec logs in once.
  retries: 0,
  workers: 1,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: target.baseURL,
    extraHTTPHeaders: target.headers,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
