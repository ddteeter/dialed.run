import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

import { garminStubPort, pointServerAtStub } from "./e2e/garmin/stub-origin";

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
const stubPort = garminStubPort(port);

/**
 * What the suite drives. The dev server by default, which is what a lane
 * iterates against. `E2E_SERVER=preview` serves the production build
 * instead: the Worker bundle `npm run build` wrote, run by workerd. Dev
 * never runs that bundle, so a dependency update that breaks the build's
 * server rendering but not dev's is invisible to the default run, and
 * CI's `e2e (build)` job exists to see it (design 156). It serves `dist/`,
 * so build first.
 */
const server = process.env.E2E_SERVER === "preview" ? "preview" : "dev";
const serverCommand =
  server === "preview"
    ? `npx vite preview --port ${String(port)} --strictPort`
    : "npm run dev";

/**
 * Milliseconds of pacing between demo actions, and the switch that decides
 * whether a video is recorded at all. 0 (the default, and what CI gets)
 * means full speed and no video. `npm run demo` sets it.
 */
const demoSlowMo = Number(process.env.DEMO_SLOWMO ?? 0);

/**
 * A recorded project's options at one size: the viewport and the video
 * together, so the page fills the frame, at the `demo` project's pacing.
 */
function recordedAt(size: { width: number; height: number }) {
  return {
    viewport: size,
    reducedMotion: "no-preference" as const,
    launchOptions: { slowMo: demoSlowMo },
    video: demoSlowMo ? { mode: "on" as const, size } : ("off" as const),
  };
}

/**
 * The product walkthroughs (design 180, step 5): the committed, narrated
 * stories, recorded at both widths. CI runs them at the desk as
 * assertions; the phone run exists only while recording, so CI pays once
 * per story and the two never write the same transcript (the template
 * below keys on the file).
 */
const WALKTHROUGHS = "walkthroughs/*.walkthrough.spec.ts";
const walkthroughProjects = [
  {
    name: "walkthrough",
    testMatch: WALKTHROUGHS,
    use: recordedAt({ width: 1280, height: 720 }),
  },
  ...(demoSlowMo
    ? [
        {
          name: "walkthrough-phone",
          testMatch: WALKTHROUGHS,
          use: recordedAt({ width: 390, height: 844 }),
        },
      ]
    : []),
];

/**
 * The styling audit's own specs (design 205): dense seeded data and the
 * states the suite does not reach, shot by the a11y fixture's
 * `auditShot` hook. They exist only for a capture, so the project exists
 * only while `AUDIT_SHOTS` names the folder the shots go to; CI, which
 * never sets it, never sees them. The skill `styling-audit` has the run.
 */
const AUDIT_SPECS = "audit/**/*.audit.spec.ts";
const isCapturing = (process.env.AUDIT_SHOTS ?? "") !== "";
const auditProjects = isCapturing
  ? [
      {
        name: "audit",
        testMatch: AUDIT_SPECS,
        use: { viewport: { width: 1280, height: 800 } },
      },
    ]
  : [];

export default defineConfig({
  testDir: "e2e",
  // One worker, because every spec shares one dev server and one local D1 —
  // which is one SQLite file. Specs sign up users, so they all write, and
  // parallel workers produce `SQLITE_BUSY: database is locked` on the
  // session insert. That surfaces as a spec failing on an element that
  // never appeared, which reads like a flaky assertion and is not one.
  //
  // A database per worker is the right answer and is not expensive — an
  // empty SQLite file is free and this dev server boots in ~210ms. What it
  // costs is wiring, because the database belongs to the dev server, not to
  // the test: `@cloudflare/vite-plugin` keeps local D1 under `persistState`
  // (default `.wrangler/state`), so isolation means N dev servers on N ports
  // with N state directories, and Playwright has no per-worker `webServer`.
  // The recipe: make `persistState.path` and `PORT` read the same env var in
  // vite.config.ts, start the servers from a globalSetup indexed by worker,
  // and hand each worker its baseURL from a fixture. That is a real change to
  // a human-managed config file for a suite that currently runs in ~11s, so
  // it waits until the suite is slow enough to pay for it.
  workers: 1,
  use: { baseURL: `http://localhost:${String(port)}` },
  // Plan 161, step 3: the a11y coverage figure and the route check, once
  // the whole run is over (a no-op unless it measured).
  // Design 182, part 2: D1 queries per request, report-only, second.
  globalTeardown: [
    "./e2e/support/a11y-coverage-teardown.ts",
    "./e2e/support/query-report-teardown.ts",
  ],
  // Plan 161, step 4: each test's screen-reader transcript, checked in.
  // One file per test, with no platform or project suffix: the text is
  // the same on a laptop and in CI, and the default template would make
  // a Linux copy of every macOS one.
  snapshotPathTemplate: "{testDir}/transcripts/{testFilePath}/{arg}{ext}",
  // One demo per feature carries the happy-path journey and is recorded; the
  // edge-case specs around it are not. Recording everything would bury the
  // journey in thirty validation cases and make the video unwatchable.
  projects: [
    {
      name: "e2e",
      testIgnore: [
        "**/*.journey.spec.ts",
        "**/*.setup.ts",
        "scratch/**",
        WALKTHROUGHS,
        AUDIT_SPECS,
      ],
      // **Depends on `demo-setup` so a signed-in spec can live here.**
      //
      // `verdict-row.spec.ts` needs an owner's session — the verdict screen
      // is owner-only — and reached for `storageStateFor("verdict")`, which
      // only `demo-setup` writes. Locally that passed, because a previous
      // `npm run demo` had left the file in `node_modules/.cache`. CI has no
      // such leftover and the spec failed there with ENOENT: the exact shape
      // CLAUDE.md warns about, where local green is not proof.
      //
      // The alternative was signing up inline in the spec, which is the
      // eleven seconds of form-filling this project exists to avoid — and it
      // would be copied by the next spec that needs an account. The cost is
      // five signups (~5s) before an e2e run that previously needed none.
      dependencies: ["demo-setup"],
    },
    // Creates one account per demo and saves its session, so no demo spends
    // the first eleven seconds of its video filling in a signup form. It is
    // a separate project on purpose: `video` is configured on `demo` alone,
    // so nothing here is recorded.
    { name: "demo-setup", testMatch: "**/*.setup.ts" },
    {
      name: "demo",
      // Plus a PR's throwaway demo (`e2e/scratch/`, gitignored), but only
      // while recording: a scratch spec is never an assertion anyone else
      // runs, so a bare run, CI's included, never sees one (design 180).
      testMatch: demoSlowMo
        ? ["**/*.journey.spec.ts", "scratch/**/*.spec.ts"]
        : "**/*.journey.spec.ts",
      dependencies: ["demo-setup"],
      use: {
        viewport: { width: 1280, height: 720 },
        // "no-preference", explicitly: motion.css collapses moves under
        // reduced motion, and a demo must record the full experience.
        reducedMotion: "no-preference",
        // Pacing and recording are OPT-IN, via DEMO_SLOWMO.
        //
        // A demo that runs at machine speed is unwatchable — the first
        // recording of the auth journey was 1.7s end to end — so `npm run
        // demo` sets DEMO_SLOWMO and every action is paced.
        //
        // But CI does not watch videos, and it was paying the pacing
        // anyway: the closet journey measured 7.7s unpaced against 51.9s
        // paced — 44s of pure waiting, per demo, per run. Worse, it made
        // the 30s default timeout a moving target, which is exactly how
        // that spec broke when a raise landed on a branch written before
        // it. So bare `playwright test` (what CI runs) exercises the demo
        // journeys at full speed and asserts everything they assert.
        // Recording is a separate, deliberate act.
        //
        // **This number is small now, and `scene()` is why** (R-58).
        // Pacing used to be 1800ms on *every* action — keystrokes and
        // trivial clicks included — because one knob had to serve both
        // "keep an action legible" and "give the viewer time to understand
        // a new screen". They want very different amounts of time. So the
        // second job moved to `e2e/support/demo.ts`'s `scene()`, which
        // holds a beat and captions what it is holding for, and this went
        // back to being only the first job. A caption also says what the
        // neighbouring assertion proves, which is what PR review actually
        // checks — see the pr-demo-video skill.
        //
        // Slowing the video in post is not the alternative — Playwright
        // captures ~25fps, so a 7.7s run is ~192 frames, and stretching
        // those over 52s yields under 4fps. A slideshow, not a demo.
        launchOptions: { slowMo: demoSlowMo },
        video: demoSlowMo
          ? { mode: "on", size: { width: 1280, height: 720 } }
          : "off",
      },
    },
    ...walkthroughProjects,
    ...auditProjects,
  ],
  webServer: [
    {
      command: serverCommand,
      // VITE_DEVTOOLS=off keeps the floating devtools button out of demo
      // recordings (it covers the tab bar's last item at 1280×720).
      env: {
        PORT: String(port),
        VITE_DEVTOOLS: "off",
        // Each response says what it asked D1 (design 182); the dev leg
        // only, since a build made without it folds the counter away.
        VITE_D1_QUERY_TALLY: "1",
        ...pointServerAtStub(server, stubPort),
      },
      url: `http://localhost:${String(port)}`,
      // Never reuse: with per-worktree ports there is nothing legitimate to
      // reuse, and a busy port must fail loudly rather than hand these tests a
      // server built from a different worktree.
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // Garmin's Personal API, stubbed (plan 160, step 9), on a port that
    // follows the app's so worktrees never share one. `pointServerAtStub`
    // above points the server's `GARMIN_API_ORIGIN` here; how is
    // `e2e/garmin/stub-origin.ts`'s. Synthetic answers only;
    // `e2e/garmin/stub-server.ts` says what it serves.
    {
      command: "tsx e2e/garmin/stub-server.ts",
      env: { GARMIN_STUB_PORT: String(stubPort) },
      url: `http://localhost:${String(stubPort)}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
