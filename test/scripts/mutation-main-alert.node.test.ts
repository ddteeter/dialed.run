/**
 * `scripts/mutation-main-alert.sh` against a stub `gh` on PATH. The stub
 * answers `issue list` and `issue view` with the JSON a test gives it,
 * whatever flags it is called with, and records every call that would
 * change an issue. So the issue the script picks, and the text it counts as
 * already reported, are the script's own jq, not the stub's. A call's
 * multi-line body is logged on one line.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withoutGitEnv } from "./git-env";

const SCRIPT = path.resolve("scripts/mutation-main-alert.sh");
const TITLE = "Mutation is red on main";
const BOT = { login: "app/github-actions" };
const STRANGER = { login: "someone-else" };

const STUB = `#!/bin/sh
case "$1 $2" in
"issue list") cat "$STUB_DIR/issues.json" ;;
"issue view") cat "$STUB_DIR/thread.json" ;;
"run view") echo "- Mutation score: lib (ts): failure (https://example.test/job)" ;;
*) printf '%s' "$*" | tr '\\n' ' ' >>"$STUB_DIR/calls.log"; echo >>"$STUB_DIR/calls.log" ;;
esac
`;

interface Issue {
  readonly number: number;
  readonly title: string;
  readonly author: { readonly login: string };
}

interface Comment {
  readonly body: string;
  readonly viewerDidAuthor: boolean;
}

interface Scenario {
  readonly result: "success" | "failure";
  readonly issues: readonly Issue[];
  readonly thread?: { readonly body: string; readonly comments: Comment[] };
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/**
Runs the script for run 42 and returns the calls that change an issue.
*/
function runAlert(scenario: Scenario): string[] {
  const directory = mkdtempSync(path.join(tmpdir(), "mutation-alert-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "gh"), STUB);
  chmodSync(path.join(directory, "gh"), 0o755);
  writeFileSync(
    path.join(directory, "issues.json"),
    JSON.stringify(scenario.issues),
  );
  writeFileSync(
    path.join(directory, "thread.json"),
    JSON.stringify(scenario.thread ?? { body: "", comments: [] }),
  );
  writeFileSync(path.join(directory, "calls.log"), "");
  const run = spawnSync("/bin/sh", [SCRIPT, "42", scenario.result, "abc123"], {
    encoding: "utf8",
    env: {
      ...withoutGitEnv(process.env),
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      STUB_DIR: directory,
      GH_REPO: "owner/repo",
    },
  });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  return readFileSync(path.join(directory, "calls.log"), "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

const RUN_42 = "https://github.com/owner/repo/actions/runs/42";

describe("main's mutation alert", () => {
  it("opens its own labelled issue when the only open one with the title is someone else's", () => {
    const calls = runAlert({
      result: "failure",
      issues: [{ number: 7, title: TITLE, author: STRANGER }],
      thread: {
        body: RUN_42,
        comments: [{ body: RUN_42, viewerDidAuthor: false }],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^issue create --repo owner\/repo --title /);
    expect(calls[0]).toContain("--label sev:important");
    expect(calls[0]).toContain(RUN_42);
  });

  it("comments on its own issue when only someone else's comment names the run", () => {
    const calls = runAlert({
      result: "failure",
      issues: [
        { number: 7, title: TITLE, author: STRANGER },
        { number: 9, title: TITLE, author: BOT },
      ],
      thread: {
        body: "Main's Mutation run https://github.com/owner/repo/actions/runs/41 went red.",
        comments: [{ body: `see ${RUN_42}`, viewerDidAuthor: false }],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^issue comment 9 --repo owner\/repo --body /);
    expect(calls[0]).toContain(RUN_42);
  });

  it("posts nothing when its own comment already names the run", () => {
    const calls = runAlert({
      result: "failure",
      issues: [{ number: 9, title: TITLE, author: BOT }],
      thread: {
        body: "red on 41",
        comments: [{ body: `run ${RUN_42}`, viewerDidAuthor: true }],
      },
    });
    expect(calls).toEqual([]);
  });

  it("closes its own issue when main is green", () => {
    const calls = runAlert({
      result: "success",
      issues: [{ number: 9, title: TITLE, author: BOT }],
      thread: { body: "red on 41", comments: [] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^issue close 9 --repo owner\/repo --comment /);
  });

  it("ignores an issue whose title only contains the alert's", () => {
    const calls = runAlert({
      result: "failure",
      issues: [{ number: 9, title: `${TITLE} again`, author: BOT }],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^issue create /);
  });
});
