import { describe, expect, it } from "vitest";

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
    expect([...pins][0]).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
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
