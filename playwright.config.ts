import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

/** The checked-out branch, read from git's own files rather than the `git`
 *  binary (shelling out to a PATH lookup trips sonarjs/no-os-command-from-path).
 *  In a worktree `.git` is a file pointing at the real gitdir, so both plain
 *  checkouts and lane worktrees resolve. */
function currentBranch(): string | undefined {
  try {
    let gitDir = path.join(process.cwd(), ".git");
    if (statSync(gitDir).isFile()) {
      const pointer = /^gitdir: (?<dir>.+)$/mu.exec(
        readFileSync(gitDir, "utf8"),
      )?.groups?.dir;
      if (pointer === undefined) return undefined;
      gitDir = path.resolve(path.dirname(gitDir), pointer.trim());
    }
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    return /^ref: refs\/heads\/(?<branch>.+)$/u.exec(head)?.groups?.branch;
  } catch {
    // Not a git checkout, or HEAD is unreadable — the caller falls back.
    return undefined;
  }
}

/** Lane worktrees run concurrently (docs/workflow.md §Fan-out). A shared port
 *  plus `reuseExistingServer` silently pointed one lane's tests at another
 *  lane's dev server, so each worktree gets its own: an explicit
 *  DIALED_E2E_PORT wins, else `lane/<N>-*` maps to 3000+N, else 3000 — which
 *  covers CI and any non-lane branch. */
function resolvePort(): number {
  const explicit = process.env.DIALED_E2E_PORT;
  if (explicit !== undefined && explicit !== "") return Number(explicit);

  const branch = currentBranch() ?? path.basename(process.cwd());
  const lane = /^(?:lane\/|dialed-)(?<number>\d+)(?:-|$)/u.exec(branch)?.groups
    ?.number;
  return lane === undefined ? 3000 : 3000 + Number(lane);
}

const port = resolvePort();

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${String(port)}` },
  // One demo per feature carries the happy-path journey and is recorded; the
  // edge-case specs around it are not. Recording everything would bury the
  // journey in thirty validation cases and make the video unwatchable.
  projects: [
    { name: "e2e", testIgnore: "**/*.demo.spec.ts" },
    {
      name: "demo",
      testMatch: "**/*.demo.spec.ts",
      use: {
        viewport: { width: 1280, height: 720 },
        reducedMotion: "reduce",
        // A demo that runs at machine speed is unwatchable — the first
        // recording of the auth journey was 1.7s end to end. slowMo paces
        // every action so a reviewer can follow what happened, without
        // sleeps polluting the spec. Raised twice on review feedback (450 ->
        // 900 -> 1800): reviewers kept losing the cause of a state change.
        // At this pacing long journeys need a per-spec timeout bump — see
        // e2e/run-logging.
        launchOptions: { slowMo: 1800 },
        video: { mode: "on", size: { width: 1280, height: 720 } },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    // VITE_DEVTOOLS=off keeps the floating devtools button out of demo
    // recordings (it covers the tab bar's last item at 1280×720).
    env: { PORT: String(port), VITE_DEVTOOLS: "off" },
    url: `http://localhost:${String(port)}`,
    // Never reuse: with per-worktree ports there is nothing legitimate to
    // reuse, and a busy port must fail loudly rather than hand these tests a
    // server built from a different worktree.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
