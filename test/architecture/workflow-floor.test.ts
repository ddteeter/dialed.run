import { describe, expect, it } from "vitest";

import actionsLock from "../../.github/workflows/actions.lock?raw";
import issueTracker from "../../docs/agents/issue-tracker.md?raw";

/**
 * The CI security floor (design 196, #546 and #483), pinned.
 *
 * Nothing else reads a workflow for what it leaves out. `actionlint` and
 * `zizmor` check what a job says; neither notices a new job that has no
 * `harden-runner`, and GitHub accepts an issue form whose label does not
 * exist by dropping the label without a word. So these are default-deny: a
 * new job or a new form is covered the day it is added.
 *
 * The files are read as text, inlined by Vite via `?raw`, because the
 * workers pool sandboxes the real filesystem.
 */

const workflows: Record<string, string> = import.meta.glob(
  "../../.github/workflows/*.yml",
  { query: "?raw", import: "default", eager: true },
);

const issueTemplates: Record<string, string> = import.meta.glob(
  "../../.github/ISSUE_TEMPLATE/*.yml",
  { query: "?raw", import: "default", eager: true },
);

const HARDEN_RUNNER = "step-security/harden-runner@";

interface Job {
  readonly workflow: string;
  readonly name: string;
  /**
  The job's first step, as its `- ` line; "" when it has none.
  */
  readonly firstStep: string;
}

const jobHeader = /^ {2}([\w-]+):\s*$/;

function isStep(line: string): boolean {
  return line.startsWith("      - ");
}

/**
The first `- ` line after a job's `steps:`, comments and blanks skipped.
*/
function firstStepOf(body: readonly string[]): string {
  const steps = body.indexOf("    steps:");
  return steps === -1
    ? ""
    : (body.slice(steps + 1).find((line) => isStep(line)) ?? "");
}

function jobsOf(path: string, source: string): Job[] {
  const afterJobs = source.slice(source.indexOf("\njobs:\n") + 1);
  // One section per job: split where the next line is a job's header.
  const sections = afterJobs.split(/\n(?= {2}[\w-]+:\s*\n)/).slice(1);
  return sections.map((section) => {
    const [header = "", ...body] = section.split("\n");
    return {
      workflow: path.slice(path.lastIndexOf("/") + 1),
      name: jobHeader.exec(header)?.[1] ?? "",
      firstStep: firstStepOf(body),
    };
  });
}

const jobs = Object.entries(workflows).flatMap(([path, source]) =>
  jobsOf(path, source),
);

describe("every workflow job", () => {
  it("is found by this scan, so an empty result cannot pass for a clean one", () => {
    expect(Object.keys(workflows).length).toBeGreaterThanOrEqual(9);
    expect(jobs.length).toBeGreaterThanOrEqual(Object.keys(workflows).length);
    expect(jobs.map((job) => `${job.workflow}:${job.name}`)).toEqual(
      expect.arrayContaining([
        "ci.yml:test",
        "ci.yml:deploy",
        "mutation.yml:gate",
        "supply-chain.yml:zizmor",
      ]),
    );
  });

  it("starts with harden-runner, before any step that could reach the network", () => {
    const unfenced = jobs
      .filter((job) => !job.firstStep.includes(HARDEN_RUNNER))
      .map((job) => `${job.workflow}:${job.name}`);
    expect(unfenced).toEqual([]);
  });

  it("uses one harden-runner pin, so a bump moves every job together", () => {
    const pins = new Set(
      Object.values(workflows).flatMap((source) =>
        source
          .split("\n")
          .filter((line) => line.includes(HARDEN_RUNNER))
          .map((line) => line.slice(line.indexOf(HARDEN_RUNNER)).trim()),
      ),
    );
    expect([...pins]).toHaveLength(1);
    expect([...pins][0]).toMatch(/@v\d+\.\d+\.\d+$/);
  });
});

/**
The action a `uses:` line names, as the lockfile keys it: the repository
and the tag, without a path inside the repository (`actions/cache/save`
is locked as `actions/cache`).
*/
function lockKeyOf(line: string): string {
  const reference = line.slice(line.indexOf("uses:") + "uses:".length).trim();
  const [action = "", tag = ""] = reference.split("@", 2);
  return `${action.split("/", 2).join("/")}@${tag}`;
}

const byName = (left: string, right: string): number => left.localeCompare(right);

/**
`actions.lock`'s `workflows:` section, read as text: each workflow path with
the references listed under it, sorted.
*/
function lockedWorkflows(lock: string): Record<string, string[]> {
  const section = lock.slice(
    lock.indexOf("\nworkflows:\n"),
    lock.indexOf("\ndependencies:\n"),
  );
  const locked: Record<string, string[]> = {};
  let current: string[] = [];
  for (const line of section.split("\n")) {
    const workflow = /^ {4}'(?<path>[^']+)':$/u.exec(line)?.groups?.path;
    const reference = /^ {8}- '(?<ref>[^']+)'$/u.exec(line)?.groups?.ref;
    if (workflow !== undefined) {
      current = [];
      locked[workflow] = current;
    } else if (reference !== undefined) {
      current.push(reference);
    }
  }
  return Object.fromEntries(
    Object.entries(locked).map(([path, refs]) => [path, refs.toSorted(byName)]),
  );
}

/**
The references `actions.lock`'s `dependencies:` section records a full
commit for.
*/
function recordedCommits(lock: string): Set<string> {
  const entries = lock.slice(lock.indexOf("\ndependencies:\n")).split(/\n(?= {4}')/u);
  return new Set(
    entries
      .filter((entry) => /\n {8}commit: 'sha1-[0-9a-f]{40}'/u.test(entry))
      .map((entry) => /^ {4}'(?<ref>[^']+)':/u.exec(entry)?.groups?.ref ?? ""),
  );
}

const usesLines = (source: string): string[] =>
  source.split("\n").filter((line) => /^\s*(- )?uses:/u.test(line));

describe("the workflow lockfile (D-182)", () => {
  it("is read, so an empty result cannot pass for a clean one", () => {
    expect(lockedWorkflows(actionsLock)[".github/workflows/ci.yml"]).toEqual(
      expect.arrayContaining(["actions/checkout@v7.0.1"]),
    );
    expect(recordedCommits(actionsLock)).toContain("actions/checkout@v7.0.1");
  });

  it("names a full version tag on every uses: line, never a commit or a moving major", () => {
    const loose = Object.values(workflows)
      .flatMap((source) => usesLines(source))
      .filter((line) => !/@v\d+\.\d+\.\d+$/u.test(line.trim()));
    expect(loose).toEqual([]);
  });

  it("lists exactly the actions each workflow uses, so no workflow runs unlocked", () => {
    const used = Object.entries(workflows)
      .map(([path, source]): [string, string[]] => [
        `.github/workflows/${path.slice(path.lastIndexOf("/") + 1)}`,
        [...new Set(usesLines(source).map((line) => lockKeyOf(line)))].toSorted(byName),
      ])
      .filter(([, actions]) => actions.length > 0);
    expect(Object.fromEntries(used)).toEqual(lockedWorkflows(actionsLock));
  });

  it("records a commit for every action it lists", () => {
    const recorded = recordedCommits(actionsLock);
    const unrecorded = Object.values(lockedWorkflows(actionsLock))
      .flat()
      .filter((reference) => !recorded.has(reference));
    expect(unrecorded).toEqual([]);
  });
});

describe("zizmor's ignores", () => {
  it("are the four reviewed lines and no more, each naming its rule", () => {
    // An ignore is a finding someone decided to keep. A fifth needs the
    // owner's say-so and a reason beside it, as these have.
    const ignores = Object.entries(workflows).flatMap(([path, source]) =>
      Array.from(source.matchAll(/ # zizmor: ignore\[([\w-]+)\]$/gm), (match) =>
        [path.slice(path.lastIndexOf("/") + 1), match[1]].join(" "),
      ),
    );
    expect(new Set(ignores)).toEqual(
      new Set([
        "dependabot-pr.yml bot-conditions",
        "dependabot-pr.yml dangerous-triggers",
        "oss-list-commit.yml artipacked",
        "oss-list-commit.yml dangerous-triggers",
      ]),
    );
    expect(ignores).toHaveLength(4);
    const mentions = Object.values(workflows)
      .join("\n")
      .split("zizmor: ignore[").length;
    expect(mentions - 1).toBe(ignores.length);
  });
});

/**
The `kind:` labels the tracker doc lists, read from its table row.
*/
function documentedKinds(): string[] {
  const row = issueTracker
    .split("\n")
    .find((line) => line.startsWith("| kind "));
  const list = /label `kind:\*`: ([^|]+)\|/.exec(row ?? "")?.[1] ?? "";
  return list.split(",").map((kind) => `kind:${kind.trim()}`);
}

const forms = Object.entries(issueTemplates).filter(
  ([path]) => !path.endsWith("/config.yml"),
);

const config =
  Object.entries(issueTemplates).find(([path]) =>
    path.endsWith("/config.yml"),
  )?.[1] ?? "";

describe("the issue forms", () => {
  it("are the three the tracker doc names", () => {
    expect(
      forms.map(([path]) => path.slice(path.lastIndexOf("/") + 1)),
    ).toEqual(["build.yml", "design-ask.yml", "owner-question.yml"]);
  });

  it.each(forms)(
    "%s presets one kind label the tracker doc lists",
    (_path, source) => {
      const labels = /^labels: \["([^"]+)"\]$/m.exec(source)?.[1];
      expect(documentedKinds()).toContain(labels);
    },
  );

  it.each(forms)("%s joins the Project", (_path, source) => {
    expect(source).toMatch(/^projects: \["ddteeter\/2"\]$/m);
    expect(issueTracker).toContain("github.com/users/ddteeter/projects/2");
  });

  it.each(forms)("%s asks for the tracker's body fields", (_path, source) => {
    const fieldLabels = Array.from(
      source.matchAll(/^ {6}label: (.+)$/gm),
      (match) => match[1],
    );
    expect(fieldLabels).toEqual(
      expect.arrayContaining(["Trigger", "What", "Where", "Links"]),
    );
  });
});

describe("the issue chooser", () => {
  it("offers no blank issue", () => {
    expect(config).toMatch(/^blank_issues_enabled: false$/m);
  });

  it("sends a security report to private reporting, as SECURITY.md does", () => {
    expect(config).toMatch(
      /^ {4}url: https:\/\/github\.com\/ddteeter\/dialed\.run\/security\/advisories\/new$/m,
    );
  });
});
