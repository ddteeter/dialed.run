import { describe, expect, it } from "vitest";

import {
  anchorProblems,
  staleReport,
  staleStories,
  storyOf,
  type Story,
} from "../../scripts/diagrams/anchors";

const FLOW = "docs/diagrams/flows/a.c4";

const TEXT = [
  "views {",
  "  view index {",
  "    include *",
  "  }",
  "  dynamic view aStory {",
  "    title 'A story'",
  "    // a comment that is not a source",
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

/**
The steps LikeC4 places at lines 9, 16 and 18, and 23.
*/
const STORIES = [
  storyOf("aStory", FLOW, TEXT, [9, 16, 18]),
  storyOf("bStory", FLOW, TEXT, [23]),
];

describe("storyOf", () => {
  it("keeps the view, the file and each step's line", () => {
    expect(
      STORIES.map((story) => ({
        view: story.view,
        file: story.file,
        lines: story.steps.map((step) => step.line),
      })),
    ).toStrictEqual([
      { view: "aStory", file: FLOW, lines: [9, 16, 18] },
      { view: "bStory", file: FLOW, lines: [23] },
    ]);
  });

  it("reads each cite's path, symbols and note from the line above", () => {
    expect(STORIES[0]?.steps.map((step) => step.cites)).toStrictEqual([
      [
        {
          path: "src/a.ts",
          symbols: ["f", "g"],
          note: "a note, with a comma; and a semicolon",
        },
        { path: "wrangler.jsonc", symbols: ["queues.consumers"] },
      ],
      [{ path: "src/a.ts", symbols: ["f"] }],
      undefined,
    ]);
  });

  it("takes only the line directly above as the step's comment", () => {
    expect(STORIES[1]?.steps[0]?.cites).toBeUndefined();
  });

  it("reads a step on the first line as having no comment", () => {
    expect(storyOf("s", FLOW, "a -> b", [1]).steps[0]?.cites).toBeUndefined();
  });

  it("reads a cite with a note and no symbol as having none", () => {
    expect(
      oneStep("// source: src/a.ts f (a (nested) note)")[0]?.steps[0]?.cites,
    ).toStrictEqual([
      { path: "src/a.ts", symbols: ["f"], note: "a (nested) note" },
    ]);
    expect(
      oneStep("// source: src/a.ts (the give-up)")[0]?.steps[0]?.cites,
    ).toStrictEqual([{ path: "src/a.ts", symbols: [], note: "the give-up" }]);
  });
});

/**
One story whose one step, on line 2, has `source` above it.
*/
function oneStep(source: string): Story[] {
  return [storyOf("s", FLOW, `${source}\n  a -> b`, [2])];
}

const FILES = new Map([
  ["src/a.ts", "export function didClaimImport() {}\nconst $limit = 1;"],
  ["wrangler.jsonc", `{ "queues": { "consumers": [] } }`],
]);

describe("anchorProblems", () => {
  it("passes symbols the file holds, a $ name and each part of a dotted one", () => {
    expect(
      anchorProblems(
        oneStep(
          "// source: src/a.ts didClaimImport, $limit; wrangler.jsonc queues.consumers",
        ),
        FILES,
      ),
    ).toStrictEqual([]);
  });

  it("names the file, line and view of a step with no comment", () => {
    expect(anchorProblems(oneStep("// a comment"), FILES)).toStrictEqual([
      `${FLOW}:2 (s): the step has no // source: comment above it`,
    ]);
  });

  it("fails a path that is not a file, and a cite with no symbol", () => {
    expect(
      anchorProblems(oneStep("// source: a.ts f; src/a.ts (a note)"), FILES),
    ).toStrictEqual([
      `${FLOW}:2 (s): a.ts is not a file`,
      `${FLOW}:2 (s): src/a.ts names no symbol`,
    ]);
  });

  it("matches whole words only, and every part of a dotted symbol", () => {
    expect(
      anchorProblems(
        oneStep(
          "// source: src/a.ts didClaim, limit; wrangler.jsonc queues.producers",
        ),
        FILES,
      ),
    ).toStrictEqual([
      `${FLOW}:2 (s): src/a.ts has no didClaim`,
      `${FLOW}:2 (s): src/a.ts has no limit`,
      `${FLOW}:2 (s): wrangler.jsonc has no queues.producers`,
    ]);
  });

  it("refuses a symbol that is not a name, even one the file holds as text", () => {
    expect(
      anchorProblems(
        oneStep("// source: src/a.ts function didClaimImport, max_retries 3"),
        FILES,
      ),
    ).toStrictEqual([
      `${FLOW}:2 (s): "function didClaimImport" is not a symbol`,
      `${FLOW}:2 (s): "max_retries 3" is not a symbol`,
    ]);
  });
});

describe("staleStories", () => {
  const stories = STORIES;

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
        'Stories that cite a file this branch changed. Under "## Diagrams" in the PR body, give each its own line, "- `<view>`: updated, <what changed>." or "- `<view>`: re-read, still holds." (skill diagram-audit counts the re-reads):',
        "- a (x.c4, edited on this branch): p, q",
        "- b (y.c4): p",
      ].join("\n"),
    );
  });
});
