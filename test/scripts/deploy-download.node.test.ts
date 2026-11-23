/**
 * The deploy job's "Check the download holds only the build" step
 * (`.github/workflows/ci.yml`), run from the file in a real git checkout
 * with a `.gitignore` like this repository's, after files land in it the
 * way the artifact download would put them.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runStep, scriptOf } from "./workflow-step";

const GIT = "/usr/bin/git";
const WORKFLOW = readFileSync(path.resolve(".github/workflows/ci.yml"), "utf8");
const STEP = "Check the download holds only the build";
const BUILD = {
  "dist/server/index.js": "export default {};",
  "dist/server/wrangler.json": "{}",
  "dist/client/assets/app.js": "",
  ".wrangler/deploy/config.json": "{}",
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function write(root: string, files: Readonly<Record<string, string>>): void {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
}

/**
A checkout of one commit, then `download` written over it, then the step.
*/
function checkAfter(download: Readonly<Record<string, string>>) {
  const root = mkdtempSync(path.join(tmpdir(), "deploy-download-"));
  directories.push(root);
  write(root, {
    ".gitignore": "node_modules/\ndist/\n.wrangler/\n.env\n.dev.vars\n",
    "package.json": "{}",
    "package-lock.json": "{}",
    "wrangler.jsonc": "{}",
    "migrations/core/0001_init.sql": "",
  });
  const git = (...args: string[]): void => {
    execFileSync(GIT, args, {
      cwd: root,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@example.invalid",
      },
    });
  };
  git("init", "--quiet");
  git("add", "-A");
  git("commit", "--quiet", "-m", "the commit that was built");
  write(root, download);
  return runStep(scriptOf(WORKFLOW, STEP), { cwd: root, env: {} });
}

describe("the deploy job's check of the downloaded build", () => {
  it("passes a download of dist/ and the deploy config", () => {
    const run = checkAfter(BUILD);
    expect(run.stdout).not.toContain("::error::");
    expect(run.status).toBe(0);
  });

  it.each([
    [".env", "API=x"],
    [".dev.vars", "x"],
    ["package-lock.json", '{"changed": true}'],
    ["wrangler.jsonc", '{"main": "x"}'],
    ["migrations/core/0002_more.sql", ""],
    [".npmrc", "registry=x"],
    [".wrangler/state/v3/d1/x.sqlite", ""],
    [".wrangler/deploy/other.json", "{}"],
    ["node_modules/wrangler/bin.js", ""],
    ["distx/a.js", ""],
  ])("fails a download that also holds %s, and names it", (name, content) => {
    const run = checkAfter({ ...BUILD, [name]: content });
    expect(run.stdout).toContain("::error::");
    expect(run.stdout).toContain(`\n  ${name}\n`);
    expect(run.status).toBe(1);
  });
});
