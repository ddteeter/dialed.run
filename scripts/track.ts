/**
 * `npm run track -- <command>`: the one writer of the Project's fields
 * (design 181, docs/agents/issue-tracker.md). Labels and milestones are
 * plain `gh issue`; Status and Lane sit behind opaque GraphQL ids, which
 * this reads from the Project on each run.
 *
 *   status <issue> <status>        set Status (e.g. needs-owner, ready)
 *   lane <issue> <text>            set Lane ("" clears it)
 *   list <status|inbox|all> [--json]
 *   check <file>...                the never-list backstop on files
 *   create --title <t> --body-file <f> [--label <l>]... [--milestone <m>]
 *          [--status <s>] [--lane <x>] [--parent <n>]
 *
 * It uses the caller's own `gh` login (scope `project`) and holds no
 * secrets. `create` and `check` refuse text that matches the never-list's
 * patterns (.claude/rules/publishing.md); they cannot judge the rest of
 * that rule, which stays the author's job.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import {
  ISSUE_ITEMS_QUERY,
  ITEMS_QUERY,
  PROJECT_NUMBER,
  PROJECT_OWNER,
  PROJECT_QUERY,
  REPO_NAME,
  isAlreadyInProject,
  issueNumberFromUrl,
  isRateLimited,
  neverListHits,
  parseAddedItem,
  parseIssueItem,
  parseItemsPage,
  parseProject,
  selectIssues,
  statusFor,
} from "./track/core";
import type { IssueItem, ProjectMeta, TrackedIssue } from "./track/core";

const run = promisify(execFile);

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

function stderrOf(error: unknown): string {
  if (
    error instanceof Error &&
    "stderr" in error &&
    typeof error.stderr === "string"
  ) {
    return error.stderr;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
Runs `gh`, waiting out GitHub's rate limits rather than failing a bulk run.
*/
async function gh(args: readonly string[]): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { stdout } = await run("gh", [...args], {
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRateLimited(stderrOf(error))) {
        throw new Error(
          `gh ${args[0] ?? ""} failed: ${stderrOf(error).trim()}`,
          {
            cause: error,
          },
        );
      }
      console.error(`rate-limited; retrying in ${String(delay / 1000)}s`);
      await sleep(delay);
    }
  }
}

async function graphql(
  query: string,
  variables: Record<string, string | number>,
) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [name, value] of Object.entries(variables)) {
    args.push(
      typeof value === "number" ? "-F" : "-f",
      `${name}=${String(value)}`,
    );
  }
  const stdout = await gh(args);
  const parsed: unknown = JSON.parse(stdout);
  return parsed;
}

async function loadProject(): Promise<ProjectMeta> {
  return parseProject(
    await graphql(PROJECT_QUERY, {
      owner: PROJECT_OWNER,
      number: PROJECT_NUMBER,
    }),
  );
}

async function findItem(meta: ProjectMeta, issue: number): Promise<IssueItem> {
  return parseIssueItem(
    await graphql(ISSUE_ITEMS_QUERY, {
      owner: PROJECT_OWNER,
      name: REPO_NAME,
      number: issue,
    }),
    meta.id,
  );
}

async function itemIdFor(meta: ProjectMeta, issue: number): Promise<string> {
  const found = await findItem(meta, issue);
  if (found.itemId !== undefined) return found.itemId;
  try {
    return parseAddedItem(
      await graphql(
        `
          mutation ($project: ID!, $content: ID!) {
            addProjectV2ItemById(
              input: { projectId: $project, contentId: $content }
            ) {
              item {
                id
              }
            }
          }
        `,
        { project: meta.id, content: found.issueId },
      ),
    );
  } catch (error) {
    // The auto-add workflow got there between the look and the add.
    const message = error instanceof Error ? error.message : String(error);
    const again = isAlreadyInProject(message)
      ? await findItem(meta, issue)
      : undefined;
    if (again?.itemId === undefined) throw error;
    return again.itemId;
  }
}

async function setStatus(
  meta: ProjectMeta,
  issue: number,
  slug: string,
): Promise<void> {
  const option = statusFor(meta, slug);
  const item = await itemIdFor(meta, issue);
  await graphql(
    `
      mutation ($project: ID!, $item: ID!, $field: ID!, $option: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $project
            itemId: $item
            fieldId: $field
            value: { singleSelectOptionId: $option }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `,
    { project: meta.id, item, field: meta.statusFieldId, option: option.id },
  );
  console.log(`#${String(issue)} → ${option.name}`);
}

async function setLane(
  meta: ProjectMeta,
  issue: number,
  lane: string,
): Promise<void> {
  const item = await itemIdFor(meta, issue);
  await (lane === ""
    ? graphql(
        `
          mutation ($project: ID!, $item: ID!, $field: ID!) {
            clearProjectV2ItemFieldValue(
              input: { projectId: $project, itemId: $item, fieldId: $field }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `,
        { project: meta.id, item, field: meta.laneFieldId },
      )
    : graphql(
        `
          mutation ($project: ID!, $item: ID!, $field: ID!, $text: String!) {
            updateProjectV2ItemFieldValue(
              input: {
                projectId: $project
                itemId: $item
                fieldId: $field
                value: { text: $text }
              }
            ) {
              projectV2Item {
                id
              }
            }
          }
        `,
        { project: meta.id, item, field: meta.laneFieldId, text: lane },
      ));
  console.log(`#${String(issue)} lane → ${lane === "" ? "(none)" : lane}`);
}

async function allIssues(meta: ProjectMeta): Promise<readonly TrackedIssue[]> {
  const issues: TrackedIssue[] = [];
  let after: string | undefined;
  do {
    const page = parseItemsPage(
      await graphql(
        ITEMS_QUERY,
        after === undefined ? { id: meta.id } : { id: meta.id, after },
      ),
    );
    issues.push(...page.issues);
    after = page.next;
  } while (after !== undefined);
  return issues;
}

async function list(
  meta: ProjectMeta,
  which: string,
  shouldPrintJson: boolean,
): Promise<void> {
  const issues = selectIssues(await allIssues(meta), meta, which);
  if (shouldPrintJson) {
    console.log(JSON.stringify(issues, undefined, 2));
    return;
  }
  for (const issue of issues) {
    const lane = issue.lane === "" ? "" : `  [${issue.lane}]`;
    console.log(
      `#${String(issue.number)}  ${issue.status || "inbox"}  ${issue.title}${lane}`,
    );
  }
}

/**
Throws when any of the texts matches the never-list; names kind and line, never the match.
*/
function refuseNeverList(texts: Readonly<Record<string, string>>): void {
  const problems: string[] = [];
  for (const [source, text] of Object.entries(texts)) {
    for (const hit of neverListHits(text)) {
      problems.push(`${source}:${String(hit.line)}: looks like a ${hit.kind}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `refused by the never-list (.claude/rules/publishing.md):\n  ${problems.join("\n  ")}`,
    );
  }
}

function flagValues(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (const [index, arg] of args.entries()) {
    const value = args[index + 1];
    if (arg === flag && value !== undefined) values.push(value);
  }
  return values;
}

function oneFlag(args: readonly string[], flag: string): string | undefined {
  const values = flagValues(args, flag);
  if (values.length > 1) throw new Error(`${flag} given more than once`);
  return values[0];
}

async function create(args: readonly string[]): Promise<void> {
  const title = oneFlag(args, "--title");
  const bodyFile = oneFlag(args, "--body-file");
  if (title === undefined || bodyFile === undefined) {
    throw new Error("create needs --title and --body-file");
  }
  const body = readFileSync(bodyFile, "utf8");
  refuseNeverList({ title, [bodyFile]: body });

  const status = oneFlag(args, "--status");
  const lane = oneFlag(args, "--lane");
  const meta =
    status === undefined && lane === undefined
      ? undefined
      : await loadProject();
  if (meta !== undefined && status !== undefined) statusFor(meta, status);

  const issueArgs = [
    "issue",
    "create",
    "--title",
    title,
    "--body-file",
    bodyFile,
  ];
  for (const label of flagValues(args, "--label"))
    issueArgs.push("--label", label);
  const milestone = oneFlag(args, "--milestone");
  if (milestone !== undefined) issueArgs.push("--milestone", milestone);
  const issue = issueNumberFromUrl(await gh(issueArgs));
  console.log(`created #${String(issue)}`);

  const parent = oneFlag(args, "--parent");
  if (parent !== undefined) {
    await gh(["issue", "edit", parent, "--add-sub-issue", String(issue)]);
  }
  if (meta !== undefined && status !== undefined)
    await setStatus(meta, issue, status);
  if (meta !== undefined && lane !== undefined)
    await setLane(meta, issue, lane);
}

function issueArg(value: string | undefined): number {
  const issue = Number(value?.replace(/^#/, ""));
  if (!Number.isSafeInteger(issue) || issue <= 0) {
    throw new Error(`expected an issue number, got "${value ?? ""}"`);
  }
  return issue;
}

async function main(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  switch (command) {
    case "status": {
      await setStatus(await loadProject(), issueArg(rest[0]), rest[1] ?? "");
      return;
    }
    case "lane": {
      await setLane(await loadProject(), issueArg(rest[0]), rest[1] ?? "");
      return;
    }
    case "list": {
      await list(
        await loadProject(),
        rest.find((arg) => !arg.startsWith("--")) ?? "all",
        rest.includes("--json"),
      );
      return;
    }
    case "check": {
      refuseNeverList(
        Object.fromEntries(
          rest.map((file) => [file, readFileSync(file, "utf8")]),
        ),
      );
      console.log(`clean: ${String(rest.length)} file(s)`);
      return;
    }
    case "create": {
      await create(rest);
      return;
    }
    default: {
      throw new Error(
        "usage: track status|lane|list|check|create … (see scripts/track.ts)",
      );
    }
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
