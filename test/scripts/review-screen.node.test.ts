/**
 * The "Screen the review" step of both Claude reviews, run from the
 * workflow file (`./workflow-step.ts`) against an execution file shaped
 * like the one claude-code-action writes: the run's messages, the last
 * `result` holding the structured output.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runStep, scriptOf } from "./workflow-step";

const STEP = "Screen the review";

interface Review {
  readonly name: string;
  readonly heading: string;
  readonly valid: Record<string, unknown>;
}

const REVIEWS: readonly Review[] = [
  {
    name: "dependabot-pr.yml",
    heading: "### Dependency impact review",
    valid: {
      verdict: "hold",
      summary: "Read the notes.",
      breaking_changes: [
        { change: "a | b", affects_this_repo: "no", action: "none" },
      ],
      sources: ["https://example.test/notes"],
    },
  },
  {
    name: "a11y-review.yml",
    heading: "### Screen-reader transcript review",
    valid: {
      summary: "Read the notes.",
      findings: [
        {
          transcript: "e2e/transcripts/a.txt",
          said: "button",
          problem: "minor",
          suggestion: "name it",
        },
      ],
    },
  },
];

function messages(result: Record<string, unknown>): string {
  return JSON.stringify([
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [] } },
    { type: "result", ...result },
  ]);
}

function screen(
  workflow: string,
  execution: string,
): ReturnType<typeof runStep> {
  return runStep(
    `EXECUTION_FILE="$RUNNER_TEMP/execution.json"\n${scriptOf(workflow, STEP)}`,
    {
      env: { RUN_URL: "https://example.test/run" },
      files: { "execution.json": execution },
    },
  );
}

/**
The comment the step hands over, from its `comment<<DELIMITER` output.
*/
function commentOf(output: string): string {
  const match = /^comment<<(REVIEW_[\da-f]{32})\n([\s\S]*)\n\1\n$/u.exec(
    output,
  );
  return match?.[2] ?? "";
}

/**
A run that succeeded with `output` as its structured output.
*/
function ok(output: Record<string, unknown>): string {
  return messages({
    subtype: "success",
    is_error: false,
    structured_output: output,
  });
}

describe.each(REVIEWS)("the review in $name", (review) => {
  const workflow = readFileSync(
    path.resolve(".github/workflows", review.name),
    "utf8",
  );

  it("hands over the rendered comment as the job's only output", () => {
    const run = screen(workflow, ok(review.valid));
    expect(run.status).toBe(0);
    const comment = commentOf(run.output);
    expect(comment).toContain(`${review.heading}\n`);
    expect(comment).toContain("Read the notes.");
    expect(comment).toContain("[Run](https://example.test/run)");
  });

  it("drops every live @-mention", () => {
    const run = screen(
      workflow,
      ok({ ...review.valid, summary: "ask @someone" }),
    );
    expect(commentOf(run.output)).toContain("ask @\u{200B}someone");
  });

  it("escapes the summary like a table cell", () => {
    const run = screen(
      workflow,
      ok({ ...review.valid, summary: "one\ntwo | three" }),
    );
    expect(commentOf(run.output)).toContain(String.raw`one two \| three`);
  });

  it.each([
    ["a key-shaped string", "sk-ant-api03-abcdef"],
    ["a token-shaped string", `ghp_${"a".repeat(36)}`],
    ["a private key", "-----BEGIN PRIVATE KEY-----"],
  ])("hands over nothing when the review holds %s", (_, text) => {
    const run = screen(workflow, ok({ ...review.valid, summary: text }));
    expect(run.status).toBe(1);
    expect(run.output).toBe("");
  });

  it("hands over nothing when the review is not the agreed shape", () => {
    const run = screen(workflow, ok({ ...review.valid, extra: "x" }));
    expect(run.stdout).toContain("isn't the agreed shape");
    expect(run.status).toBe(1);
    expect(run.output).toBe("");
  });

  it("hands over nothing when the review is over 64 KB", () => {
    const run = screen(
      workflow,
      ok({ ...review.valid, summary: "x".repeat(70_000) }),
    );
    expect(run.stdout).toContain("over 64 KB");
    expect(run.status).toBe(1);
  });

  it("hands over nothing when the run did not succeed", () => {
    const run = screen(
      workflow,
      messages({
        subtype: "error_max_turns",
        is_error: true,
        structured_output: review.valid,
      }),
    );
    expect(run.stdout).toContain("the run returned no review");
    expect(run.status).toBe(1);
    expect(run.output).toBe("");
  });

  it("reads the last result of the run", () => {
    const execution = JSON.stringify([
      {
        type: "result",
        subtype: "success",
        structured_output: { ...review.valid, summary: "first" },
      },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        structured_output: review.valid,
      },
    ]);
    const comment = commentOf(screen(workflow, execution).output);
    expect(comment).toContain("Read the notes.");
    expect(comment).not.toContain("first");
  });
});
