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

const byName = (left: string, right: string): number =>
  left.localeCompare(right);

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
  const entries = lock
    .slice(lock.indexOf("\ndependencies:\n"))
    .split(/\n(?= {4}')/u);
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
        [...new Set(usesLines(source).map((line) => lockKeyOf(line)))].toSorted(
          byName,
        ),
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

/**
The `--allowedTools` and `--disallowedTools` lists of every Claude step.
*/
function claudeToolLists(flag: "--allowedTools" | "--disallowedTools") {
  const pattern = new RegExp(`${flag} "([^"]+)"`, "g");
  return Object.entries(workflows).flatMap(([path, source]) =>
    Array.from(source.matchAll(pattern), (match) => ({
      workflow: path.slice(path.lastIndexOf("/") + 1),
      tools: (match[1] ?? "").split(","),
    })),
  );
}

describe("the Claude review jobs (SA-M19)", () => {
  const allowed = claudeToolLists("--allowedTools");
  const disallowed = claudeToolLists("--disallowedTools");

  it("are found, so an empty result cannot pass for a clean one", () => {
    expect(allowed.map(({ workflow }) => workflow).toSorted(byName)).toEqual([
      "a11y-review.yml",
      "dependabot-pr.yml",
    ]);
    expect(disallowed).toHaveLength(allowed.length);
  });

  it("grant no Bash command", () => {
    const shells = allowed
      .filter(({ tools }) => tools.some((tool) => /^Bash\b/u.test(tool)))
      .map(({ workflow }) => workflow);
    expect(shells).toEqual([]);
  });

  it("deny Bash outright", () => {
    const open = disallowed
      .filter(({ tools }) => !tools.includes("Bash"))
      .map(({ workflow }) => workflow);
    expect(open).toEqual([]);
  });
});

describe("the Dependabot self-merge decision (SA-M38, SA-L10)", () => {
  const source =
    Object.entries(workflows).find(([path]) =>
      path.endsWith("/dependabot-pr.yml"),
    )?.[1] ?? "";
  const classify = source.slice(
    source.indexOf("\n  classify:"),
    source.indexOf("\n  auto-merge:"),
  );
  const lines = classify
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"));

  it("is the classify job, found", () => {
    expect(classify).toContain("- id: decide");
  });

  it("is the tested script's, run from main with nothing installed", () => {
    expect(lines).toContain("          node scripts/dependabot-classify.ts");
    expect(classify).not.toMatch(/\bnpm (?:ci|install|run|exec)\b|\bnpx\b/u);
    expect(classify).not.toContain("ref:");
  });

  it("does not take the PR body's word on who published a version", () => {
    expect(lines.join("\n")).not.toContain("maintainerChanges");
  });
});

/**
A workflow's source by file name; "" when there is none.
*/
function workflowNamed(name: string): string {
  return (
    Object.entries(workflows).find(([path]) =>
      path.endsWith(`/${name}`),
    )?.[1] ?? ""
  );
}

/**
One job's section of a workflow, from its header to the next job's.
*/
function jobIn(source: string, name: string): string {
  const start = source.indexOf(`\n  ${name}:\n`);
  if (start === -1) return "";
  const next = source.slice(start + 1).search(/\n {2}[\w-]+:\n/u);
  return next === -1
    ? source.slice(start)
    : source.slice(start, start + 1 + next);
}

/**
A job's lines with comment lines dropped, so prose cannot satisfy a pin.
*/
function codeOf(section: string): string {
  return section
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

describe("a Dependabot push that classify does not answer yes to", () => {
  const disarm = codeOf(jobIn(workflowNamed("dependabot-pr.yml"), "disarm"));

  it("has a job, found", () => {
    expect(disarm).toContain("needs: classify");
  });

  it("runs on a hold or a failed classify, on every push, and never on a skipped one", () => {
    const condition = /\n {4}if: (.*)\n/u.exec(disarm)?.[1] ?? "";
    expect(condition).toContain("always()");
    expect(condition).toContain("needs.classify.outputs.merge != 'true'");
    expect(condition).toContain("needs.classify.result != 'skipped'");
    expect(condition).not.toContain("synchronize");
  });

  it("turns auto-merge off with the App's token, and says why on a later push", () => {
    expect(disarm).toContain("environment: dependabot-merge");
    expect(disarm).toContain('gh pr merge --disable-auto "$PR_URL"');
    expect(disarm).toContain("GH_TOKEN: ${{ steps.app.outputs.token }}");
    expect(disarm).toContain("if: github.event.action == 'synchronize'");
    expect(disarm).toContain('gh pr comment "$PR_URL" --body-file');
  });
});

describe.each(["a11y-review.yml", "dependabot-pr.yml"])(
  "the Claude review in %s",
  (name) => {
    const source = workflowNamed(name);
    const review = codeOf(jobIn(source, "review"));
    const post = codeOf(jobIn(source, "post"));

    it("is found, so an empty result cannot pass for a clean one", () => {
      expect(review).toContain("- id: claude");
      expect(post).toContain("name: Screen and post the review");
    });

    it("starts Claude with only the settings the workflow writes", () => {
      expect(review).toMatch(/\n {12}--setting-sources user\n/u);
    });

    it("hands Claude a Bun and a Claude Code it checked, each against its own sum", () => {
      expect(review).toContain(
        "path_to_bun_executable: ${{ steps.bin.outputs.dir }}/bun",
      );
      expect(review).toContain(
        "path_to_claude_code_executable: ${{ steps.bin.outputs.dir }}/claude",
      );
      expect(review).toMatch(/\n {10}BUN_SHA256: [\da-f]{64}\n/u);
      expect(review).toMatch(/\n {10}CLAUDE_CODE_SHA256: [\da-f]{64}\n/u);
      expect(review).toContain(
        'echo "$BUN_SHA256  $bin/bun.zip" | sha256sum -c',
      );
      expect(review).toContain(
        'echo "$CLAUDE_CODE_SHA256  $bin/claude" | sha256sum -c',
      );
    });

    it("leaves the installers' hosts off its egress list", () => {
      const lines = review.split("\n").map((line) => line.trim());
      expect(lines).not.toContain("claude.ai:443");
      expect(lines).not.toContain("bun.sh:443");
      expect(lines).toContain("downloads.claude.ai:443");
    });

    it("passes the review to post as a job output, never an artifact", () => {
      expect(source).not.toContain("actions/upload-artifact@");
      expect(source).not.toContain("actions/download-artifact@");
      expect(review).toContain(
        "review: ${{ steps.claude.outputs.structured_output }}",
      );
      expect(post).toContain("REVIEW: ${{ needs.review.outputs.review }}");
    });

    it("escapes the summary as it escapes the table cells", () => {
      expect(post).toContain("\\(.summary | cell)");
      expect(post).not.toContain("\\(.summary)");
    });
  },
);

/**
The `- ` step lines of a job's steps, in order, comments and blanks skipped.
*/
function stepLinesOf(section: string): string[] {
  return section.split("\n").filter((line) => isStep(line));
}

describe("a job that blocks egress (SA-L20)", () => {
  const blocking = Object.entries(workflows).flatMap(([path, source]) =>
    source
      .slice(source.indexOf("\njobs:\n") + 1)
      .split(/\n(?= {2}[\w-]+:\s*\n)/u)
      .slice(1)
      .filter((section) => section.includes("egress-policy: block"))
      .map((section) => ({
        job: `${path.slice(path.lastIndexOf("/") + 1)}:${/^ {2}([\w-]+):/u.exec(section)?.[1] ?? ""}`,
        steps: stepLinesOf(section),
      })),
  );

  it("is found, so an empty result cannot pass for a clean one", () => {
    expect(blocking.map(({ job }) => job).toSorted(byName)).toEqual([
      "a11y-review.yml:review",
      "dependabot-pr.yml:review",
    ]);
  });

  it("proves the fence straight after harden-runner", () => {
    const unproven = blocking
      .filter(({ steps }) => steps[1] !== "      - name: The fence is up")
      .map(({ job }) => job);
    expect(unproven).toEqual([]);
  });

  it("proves it again on the step before Claude", () => {
    const unproven = blocking
      .filter(({ steps }) => {
        const claude = steps.findIndex((line) => line.includes("- id: claude"));
        return (
          claude < 1 ||
          steps[claude - 1] !== "      - name: The fence is still up"
        );
      })
      .map(({ job }) => job);
    expect(unproven).toEqual([]);
  });
});

/**
The `run:` values of a job, in order (a block scalar reads as `|`).
*/
function runsOf(section: string): string[] {
  return section
    .split("\n")
    .filter((line) => /^\s+(?:- )?run: /u.test(line))
    .map((line) => line.slice(line.indexOf("run: ") + 5));
}

describe("the deploy (SA-L10)", () => {
  const ci =
    Object.entries(workflows).find(([path]) => path.endsWith("/ci.yml"))?.[1] ??
    "";
  const job = (name: string): string => {
    const start = ci.indexOf(`\n  ${name}:\n`);
    const next = ci.slice(start + 1).search(/\n {2}[\w-]+:\n/u);
    return next === -1 ? ci.slice(start) : ci.slice(start, start + 1 + next);
  };

  it("builds in a job that holds no secret", () => {
    const bundle = job("bundle");
    expect(runsOf(bundle)).toStrictEqual(["npm ci", "npm run build"]);
    expect(bundle).not.toMatch(/environment:|secrets\./u);
  });

  it("deploys from that build, running no install script and no build", () => {
    const deploy = job("deploy");
    expect(deploy).toContain("needs: [bundle]");
    expect(deploy).toContain("name: worker-bundle");
    expect(runsOf(deploy)).toStrictEqual([
      "npm ci --ignore-scripts",
      "|",
      "npx wrangler deploy",
    ]);
    expect(deploy).toContain("environment: production");
  });
});
