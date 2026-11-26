import { describe, expect, it } from "vitest";

import guardrailsWorkflow from "../../.github/workflows/guardrails.yml?raw";
import prePush from "../../.githooks/pre-push?raw";

/**
 * The repo's additions to two files `guardrails init` scaffolds, pinned.
 *
 * `init --plan` reports both as drifted at every upgrade, and
 * `init --apply --force` would write the template over them. The template
 * has none of what is asserted here, and nothing else notices the loss
 * until CI fails for an unrelated reason, or a sanction with no grant is
 * pushed. `docs/guardrails/init-drift.md` gives the reasons (#556).
 *
 * The files are read as text, inlined by Vite via `?raw`, because the
 * workers pool sandboxes the real filesystem.
 */
describe("what a forced guardrails init would remove", () => {
  it("runs sanctions-check in the pre-push hook, after the gate", () => {
    const gate = prePush.indexOf('node "$cli" gate --mode=push');
    const sanctions = prePush.indexOf('node "$cli" sanctions-check');
    expect(gate).toBeGreaterThan(-1);
    expect(sanctions).toBeGreaterThan(gate);
  });

  it("runs build, test and diagrams:check in the pre-push hook, before the gate", () => {
    const gate = prePush.indexOf('node "$cli" gate --mode=push');
    const steps = prePush.indexOf(
      'for step in "npm run build" "npm test" "npm run diagrams:check"; do',
    );
    expect(steps).toBeGreaterThan(-1);
    expect(steps).toBeLessThan(gate);
  });

  it("runs the preflight steps without git's hook variables", () => {
    expect(prePush).toContain(
      'unset_git="env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE -u GIT_PREFIX -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY GUARDRAILS_PREFLIGHT=1"',
    );
  });

  it("runs the preflight steps under the gate lock, released before the gate", () => {
    const gate = prePush.indexOf('node "$cli" gate --mode=push');
    const locked = prePush.indexOf(
      'node "$cli" lock -- $unset_git sh "$0" </dev/null || exit 1',
    );
    expect(locked).toBeGreaterThan(-1);
    expect(locked).toBeLessThan(gate);
    expect(prePush).not.toMatch(/\b(lockf|flock) /);
  });

  it("runs none of them for a push that only deletes refs", () => {
    expect(prePush).toContain("*[!0]*) pushes_commits=yes ;;");
    expect(prePush).toContain('if [ "$pushes_commits" = yes ]; then');
  });

  it("names a full version tag on every action in guardrails.yml, not the template's floating major", () => {
    const uses = guardrailsWorkflow
      .split("\n")
      .filter((line) => /^\s*(- )?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    expect(
      uses.filter((line) => !/@v\d+\.\d+\.\d+$/.test(line.trim())),
    ).toEqual([]);
  });

  it.each([
    ["a concurrency group", "\nconcurrency:\n  group: guardrails-"],
    ["the Chromium install", "npx playwright install --with-deps chromium"],
    ["the MediaPipe staging step", "npm run stage:mediapipe"],
  ])("keeps %s in guardrails.yml", (_what, text) => {
    expect(guardrailsWorkflow).toContain(text);
  });
});
