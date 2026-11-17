import { describe, expect, it } from "vitest";

import {
  anchorProblems,
  readStories,
  staleReport,
  staleStories,
  stepCountProblems,
  type Story,
} from "../../scripts/diagrams/anchors";

const FLOW = "docs/diagrams/flows/a.c4";

const TEXT = [
  "views {",
  "  view index {",
  "    include *",
  "  }",
  "  dynamic view aStory {",
  "    title 'A } in a title'",
  "    // a } in a comment",
  "    // source: src/a.ts f, g (a note, with a comma; and a semicolon); wrangler.jsonc queues.consumers",
  "    runner -> cf.app.a 'asks' {",
  "      notes '''",
  "        a -> b is prose, and so is }",
  "      '''",
  "    }",
  "    parallel {",
  "      // source: src/a.ts f",
  "      cf.app.a -[async]-> cf.queue 'sends'",
  "    }",
  "    runner <- cf.app.a 'answers'",
  "  }",
  "  dynamic view bStory {",
  "    // source: src/b.ts h",
  "",
  "    cf.app.a -> cf.db 'writes' { notes 'x -> y' }",
  "  }",
  "}",
  "cf.app.a -> cf.db 'a relation, not a step'",
].join("\n");

describe("readStories", () => {
  const stories = readStories(FLOW, TEXT);

  it("finds each dynamic view and only its steps, past notes, frames, and braces in quotes and comments", () => {
    expect(
      stories.map((story) => ({
        view: story.view,
        file: story.file,
        lines: story.steps.map((step) => step.line),
      })),
    ).toStrictEqual([
      { view: "aStory", file: FLOW, lines: [9, 16, 18] },
      { view: "bStory", file: FLOW, lines: [23] },
    ]);
  });

  it("reads each cite's path and symbols and drops the note", () => {
    expect(stories[0]?.steps.map((step) => step.cites)).toStrictEqual([
      [
        { path: "src/a.ts", symbols: ["f", "g"] },
        { path: "wrangler.jsonc", symbols: ["queues.consumers"] },
      ],
      [{ path: "src/a.ts", symbols: ["f"] }],
      undefined,
    ]);
  });

  it("takes only the line directly above as the step's comment", () => {
    expect(stories[1]?.steps[0]?.cites).toBeUndefined();
  });

  it("reads a cite with a note and no symbol as having none", () => {
    const [story] = readStories(
      FLOW,
      "dynamic view c {\n  // source: src/a.ts (the give-up)\n  a -> b\n}",
    );

    expect(story?.steps[0]?.cites).toStrictEqual([
      { path: "src/a.ts", symbols: [] },
    ]);
  });
});

function storyOf(source: string): Story[] {
  return readStories(FLOW, `dynamic view s {\n  ${source}\n  a -> b\n}`);
}

const FILES = new Map([
  ["src/a.ts", "export function didClaimImport() {}\nconst $limit = 1;"],
  ["wrangler.jsonc", `{ "queues": { "consumers": [] } }`],
]);

describe("anchorProblems", () => {
  it("passes symbols the file holds, a $ name and each part of a dotted one", () => {
    expect(
      anchorProblems(
        storyOf(
          "// source: src/a.ts didClaimImport, $limit; wrangler.jsonc queues.consumers",
        ),
        FILES,
      ),
    ).toStrictEqual([]);
  });

  it("names the file, line and view of a step with no comment", () => {
    expect(anchorProblems(storyOf("// a comment"), FILES)).toStrictEqual([
      `${FLOW}:3 (s): the step has no // source: comment above it`,
    ]);
  });

  it("fails a path that is not a file, and a cite with no symbol", () => {
    expect(
      anchorProblems(storyOf("// source: a.ts f; src/a.ts (a note)"), FILES),
    ).toStrictEqual([
      `${FLOW}:3 (s): a.ts is not a file`,
      `${FLOW}:3 (s): src/a.ts names no symbol`,
    ]);
  });

  it("matches whole words only, and every part of a dotted symbol", () => {
    expect(
      anchorProblems(
        storyOf(
          "// source: src/a.ts didClaim, limit; wrangler.jsonc queues.producers",
        ),
        FILES,
      ),
    ).toStrictEqual([
      `${FLOW}:3 (s): src/a.ts has no didClaim`,
      `${FLOW}:3 (s): src/a.ts has no limit`,
      `${FLOW}:3 (s): wrangler.jsonc has no queues.producers`,
    ]);
  });

  it("refuses a symbol that is not a name, even one the file holds as text", () => {
    expect(
      anchorProblems(
        storyOf("// source: src/a.ts function didClaimImport, max_retries 3"),
        FILES,
      ),
    ).toStrictEqual([
      `${FLOW}:3 (s): "function didClaimImport" is not a symbol`,
      `${FLOW}:3 (s): "max_retries 3" is not a symbol`,
    ]);
  });
});

describe("staleStories", () => {
  const stories = readStories(FLOW, TEXT);

  it("lists each view citing a changed file, each file once, in citing order", () => {
    expect(
      staleStories(stories, ["src/b.ts", "wrangler.jsonc", "src/a.ts"]),
    ).toStrictEqual([
      {
        view: "aStory",
        file: FLOW,
        changed: ["src/a.ts", "wrangler.jsonc"],
        edited: false,
      },
    ]);
  });

  it("says when the view's own file changed too", () => {
    expect(
      staleStories(stories, ["src/a.ts", FLOW]).map((story) => story.edited),
    ).toStrictEqual([true]);
  });

  it("lists nothing when no cited file changed", () => {
    expect(staleStories(stories, [FLOW, "src/c.ts"])).toStrictEqual([]);
  });
});

describe("staleReport", () => {
  it("says so when nothing is stale", () => {
    expect(staleReport([])).toBe("No story cites a file this branch changed.");
  });

  it("lists each stale view with what changed", () => {
    expect(
      staleReport([
        { view: "a", file: "x.c4", changed: ["p", "q"], edited: true },
        { view: "b", file: "y.c4", changed: ["p"], edited: false },
      ]),
    ).toBe(
      [
        'Stories that cite a file this branch changed. Under "Diagrams" in the PR body, say for each whether you updated it or re-read it and it still holds:',
        "- a (x.c4, edited on this branch): p, q",
        "- b (y.c4): p",
      ].join("\n"),
    );
  });
});

describe("stepCountProblems", () => {
  const stories = readStories(FLOW, TEXT);

  it("passes when every view's count matches LikeC4's", () => {
    expect(
      stepCountProblems(
        stories,
        new Map([
          ["aStory", 3],
          ["bStory", 1],
        ]),
      ),
    ).toStrictEqual([]);
  });

  it("names each view whose count differs, or that only one side has, sorted", () => {
    expect(
      stepCountProblems(
        stories,
        new Map([
          ["aaStory", 2],
          ["aStory", 4],
        ]),
      ).map((problem) => problem.split(".", 1)[0]),
    ).toStrictEqual([
      "aaStory: LikeC4 draws 2 steps and scripts/diagrams/anchors",
      "aStory: LikeC4 draws 4 steps and scripts/diagrams/anchors",
      "bStory: LikeC4 draws 0 steps and scripts/diagrams/anchors",
    ]);
  });

  it("says what to do", () => {
    expect(stepCountProblems(stories, new Map([["aStory", 4]]))[0]).toBe(
      "aStory: LikeC4 draws 4 steps and scripts/diagrams/anchors.ts read 3. Write each step on its own line, as likec4 format does, or teach the reader the new form.",
    );
  });
});
