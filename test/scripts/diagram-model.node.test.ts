/**
 * `scripts/diagrams/model.ts` finds the steps in LikeC4's own parse tree,
 * which the workers pool cannot load, so it runs in the `node` project.
 */
import { LikeC4 } from "likec4";
import { describe, expect, it } from "vitest";

import { storiesIn, viewFactsIn } from "../../scripts/diagrams/model";

const SOURCE = [
  "specification {",
  "  element e",
  "  relationship async",
  "}",
  "model {",
  "  a = e",
  "  b = e",
  "  c = e",
  "  a -> b 'a relation, not a step'",
  "}",
  "views {",
  "  view index {",
  "    include *",
  "  }",
  "  dynamic view first {",
  "    title 'Braces } and -> in a title'",
  "    // source: src/a.ts f",
  "    a -> b 'asks' {",
  "      notes '''",
  "        b -> c is prose",
  "      '''",
  "    }",
  "    parallel {",
  "      // source: src/a.ts g",
  "      b -[async]-> c",
  "    }",
  "    try {",
  "      a <- b",
  "    }",
  "    catch 'it fails' {",
  "      c -> a",
  "    }",
  "    loop 'again' {",
  "      opt 'sometimes' {",
  "        a -> c",
  "      }",
  "    }",
  "  }",
  "  dynamic view second {",
  "    // source: src/b.ts h",
  "    a -> b -> c",
  "  }",
  "}",
].join("\n");

describe("storiesIn", () => {
  it("finds every step statement and its line, in frames too, and nothing in a note or the model", async () => {
    const likec4 = await LikeC4.fromSource(SOURCE, { logger: false });

    const stories = await storiesIn(likec4, () => "flows/x.c4");

    expect(
      stories.map((story) => ({
        view: story.view,
        file: story.file,
        lines: story.steps.map((step) => step.line),
      })),
    ).toStrictEqual([
      { view: "first", file: "flows/x.c4", lines: [18, 25, 28, 31, 35] },
      { view: "second", file: "flows/x.c4", lines: [41] },
    ]);
  });

  it("reads the comment above each step, and a chain as one step", async () => {
    const likec4 = await LikeC4.fromSource(SOURCE, { logger: false });

    const stories = await storiesIn(likec4, (fsPath) => fsPath);

    expect(
      stories.map((story) => story.steps.map((step) => step.cites)),
    ).toStrictEqual([
      [
        [{ path: "src/a.ts", symbols: ["f"] }],
        [{ path: "src/a.ts", symbols: ["g"] }],
        undefined,
        undefined,
        undefined,
      ],
      [[{ path: "src/b.ts", symbols: ["h"] }]],
    ]);
  });

  it("names only its own documents, not LikeC4's built-in library", async () => {
    const likec4 = await LikeC4.fromSource(SOURCE, { logger: false });
    const seen: string[] = [];

    await storiesIn(likec4, (fsPath) => {
      seen.push(fsPath);
      return fsPath;
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/\.c4$/u);
    expect(seen[0]).not.toContain("likec4/lib");
  });

  it("fails by name when the parse tree is not where it reads it", async () => {
    const likec4 = await LikeC4.fromSource(SOURCE, { logger: false });
    Reflect.set(likec4, "langium", {});

    await expect(storiesIn(likec4, (fsPath) => fsPath)).rejects.toThrow(
      "LikeC4's parse tree is not where scripts/diagrams/model.ts reads it",
    );
  });

  it("fails when LikeC4 draws more arrows than the walk read, naming the view", async () => {
    const likec4 = await LikeC4.fromSource(SOURCE, { logger: false });
    const model = await likec4.computedModel();
    const views = [...model.views()].map((view) =>
      view.id === "second"
        ? { id: view.id, $view: { _type: "dynamic", edges: [1, 2, 3] } }
        : view,
    );
    Reflect.set(likec4, "computedModel", () =>
      Promise.resolve({ views: () => views }),
    );

    await expect(storiesIn(likec4, (fsPath) => fsPath)).rejects.toThrow(
      "scripts/diagrams/model.ts read other steps than LikeC4 draws in second: a step form the walk does not know.",
    );
  });
});

describe("viewFactsIn", () => {
  it("reads every view in order, its steps as LikeC4 computes them", async () => {
    const likec4 = await LikeC4.fromSource(SOURCE, { logger: false });

    const views = await viewFactsIn(likec4);

    expect(
      views.map(({ id, title, dynamic, framed }) => ({
        id,
        title,
        dynamic,
        framed,
      })),
    ).toStrictEqual([
      {
        id: "index",
        title: "Landscape view",
        dynamic: false,
        framed: false,
      },
      {
        id: "first",
        title: "Braces } and -> in a title",
        dynamic: true,
        framed: true,
      },
      { id: "second", title: "second", dynamic: true, framed: false },
    ]);
    expect(views[0]?.steps).toStrictEqual([]);
    expect(views[1]?.steps.slice(0, 2)).toStrictEqual([
      {
        source: "a",
        target: "b",
        kind: "",
        label: "asks",
        notes: "b -> c is prose",
      },
      { source: "b", target: "c", kind: "async", label: "", notes: "" },
    ]);
    expect(views[2]?.steps.map((step) => [step.source, step.target])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    for (const view of views) expect(view.hash).toMatch(/^[\w-]{20,}$/u);
  });

  it("takes a view that declares the sequence variant as framed", async () => {
    const likec4 = await LikeC4.fromSource(
      [
        "specification {",
        "  element e",
        "}",
        "model {",
        "  a = e",
        "  b = e",
        "}",
        "views {",
        "  dynamic view s {",
        "    variant sequence",
        "    a -> b",
        "  }",
        "}",
      ].join("\n"),
      { logger: false },
    );

    const views = await viewFactsIn(likec4);

    expect(views.map((view) => [view.id, view.framed])).toEqual([
      ["index", false],
      ["s", true],
    ]);
  });
});
