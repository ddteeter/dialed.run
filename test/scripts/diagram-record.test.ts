import { describe, expect, it } from "vitest";

import {
  OPENING_MS,
  STEP_MAX_MS,
  STILL_VIEW_MS,
  UNCHANGED_STEP_MS,
  planReport,
  plannedMs,
  recordingPlan,
  stepHoldMs,
  viewUrl,
  type StepFacts,
  type ViewFacts,
} from "../../scripts/diagrams/record";

function step(label: string, notes = ""): StepFacts {
  return { source: "a", target: "b", kind: "", label, notes };
}

function story(steps: StepFacts[], overrides: Partial<ViewFacts> = {}) {
  return {
    id: "aStory",
    title: "A story",
    hash: "h1",
    dynamic: true,
    framed: false,
    steps,
    ...overrides,
  } satisfies ViewFacts;
}

const MAP: ViewFacts = {
  id: "modules",
  title: "The modules",
  hash: "m1",
  dynamic: false,
  framed: false,
  steps: [],
};

const THREE = [step("asks"), step("stores"), step("answers")];

describe("stepHoldMs", () => {
  it("holds an unchanged step for a beat, whatever it says", () => {
    expect(stepHoldMs(step("a long label", "and a long note"), false)).toBe(
      UNCHANGED_STEP_MS,
    );
  });

  it("holds a changed step for a beat plus 150 ms a word of label and note", () => {
    expect(stepHoldMs(step("asks", ""), true)).toBe(1650);
    expect(
      stepHoldMs(step("asks for it", "**Guard: a key.**\n\n  Twice"), true),
    ).toBe(1500 + 150 * 7);
  });

  it("never holds a step longer than the cap", () => {
    const long = step("x", "word ".repeat(200));
    const justUnder = step("x", "word ".repeat(42));
    expect(stepHoldMs(long, true)).toBe(STEP_MAX_MS);
    expect(stepHoldMs(justUnder, true)).toBe(1500 + 150 * 43);
  });
});

describe("recordingPlan", () => {
  it("records nothing when every view is the same at both ends", () => {
    const plan = recordingPlan([story(THREE), MAP], [story(THREE), MAP]);
    expect(plan).toEqual({ views: [], removed: [] });
  });

  it("records a new story whole, every step held to be read", () => {
    const plan = recordingPlan([], [story(THREE)]);
    expect(plan.views).toEqual([
      {
        id: "aStory",
        layout: "diagram",
        opening: { caption: "New view · aStory · A story", holdMs: OPENING_MS },
        steps: [
          { caption: "aStory · step 1 of 3", holdMs: 1650 },
          { caption: "aStory · step 2 of 3", holdMs: 1650 },
          { caption: "aStory · step 3 of 3", holdMs: 1650 },
        ],
      },
    ]);
  });

  it("holds a new or changed map still, with its title", () => {
    const plan = recordingPlan(
      [{ ...MAP, id: "platform" }, MAP],
      [
        { ...MAP, id: "platform", hash: "p2" },
        { ...MAP, id: "index" },
      ],
    );
    expect(plan.views).toEqual([
      {
        id: "platform",
        layout: "diagram",
        opening: {
          caption: "Changed · platform · The modules",
          holdMs: STILL_VIEW_MS,
        },
        steps: [],
      },
      {
        id: "index",
        layout: "diagram",
        opening: {
          caption: "New view · index · The modules",
          holdMs: STILL_VIEW_MS,
        },
        steps: [],
      },
    ]);
    expect(plan.removed).toEqual(["modules"]);
  });

  it("records a story whose note changed though its hash did not", () => {
    const edited = [
      step("asks"),
      step("stores", "now with a guard"),
      step("answers"),
    ];
    const plan = recordingPlan([story(THREE)], [story(edited)]);
    expect(plan.views.map((view) => view.opening.caption)).toEqual([
      "Changed · aStory · 1 of 3 steps new or changed",
    ]);
    expect(plan.views[0]?.steps).toEqual([
      {
        caption: "aStory · step 1 of 3 · unchanged",
        holdMs: UNCHANGED_STEP_MS,
      },
      {
        caption: "aStory · step 2 of 3 · changed",
        holdMs: stepHoldMs(step("stores", "now with a guard"), true),
      },
      {
        caption: "aStory · step 3 of 3 · unchanged",
        holdMs: UNCHANGED_STEP_MS,
      },
    ]);
  });

  it("marks only an inserted step changed, not every one after it", () => {
    const inserted = [
      step("asks"),
      step("checks"),
      step("stores"),
      step("answers"),
    ];
    const plan = recordingPlan(
      [story(THREE)],
      [story(inserted, { hash: "h2" })],
    );
    expect(plan.views[0]?.steps.map((shot) => shot.caption)).toEqual([
      "aStory · step 1 of 4 · unchanged",
      "aStory · step 2 of 4 · changed",
      "aStory · step 3 of 4 · unchanged",
      "aStory · step 4 of 4 · unchanged",
    ]);
  });

  it("says how many fewer steps a story has, and when none changed", () => {
    const plan = recordingPlan(
      [story(THREE)],
      [story([step("asks"), step("answers")], { hash: "h2" })],
    );
    expect(plan.views[0]?.opening).toEqual({
      caption: "Changed · aStory · no step changed, 1 fewer",
      holdMs: OPENING_MS,
    });
  });

  it("counts one step in the singular", () => {
    const plan = recordingPlan(
      [story([step("asks")])],
      [story([step("asks again")], { hash: "h2" })],
    );
    expect(plan.views[0]?.opening.caption).toBe(
      "Changed · aStory · 1 of 1 step new or changed",
    );
  });

  it("records a story whose hash changed with every step the same", () => {
    const plan = recordingPlan([story(THREE)], [story(THREE, { hash: "h2" })]);
    expect(plan.views[0]?.opening.caption).toBe(
      "Changed · aStory · no step changed",
    );
  });

  it("tells a step by everything it draws: source, target and kind too", () => {
    const moved = [
      { ...step("asks"), source: "c" },
      { ...step("stores"), target: "c" },
      { ...step("answers"), kind: "async" },
    ];
    const plan = recordingPlan([story(THREE)], [story(moved)]);
    expect(plan.views[0]?.opening.caption).toBe(
      "Changed · aStory · 3 of 3 steps new or changed",
    );
  });

  it("plays a framed view in the sequence layout", () => {
    const plan = recordingPlan(
      [],
      [story(THREE, { framed: true }), story(THREE, { id: "bStory" })],
    );
    expect(plan.views.map((view) => [view.id, view.layout])).toEqual([
      ["aStory", "sequence"],
      ["bStory", "diagram"],
    ]);
  });

  it("follows head's order, not the merge base's", () => {
    const b = story(THREE, { id: "bStory" });
    const plan = recordingPlan(
      [b, story(THREE)],
      [story(THREE, { hash: "h2" }), { ...b, hash: "h3" }],
    );
    expect(plan.views.map((view) => view.id)).toEqual(["aStory", "bStory"]);
  });
});

describe("plannedMs", () => {
  it("adds every opening and every step", () => {
    const plan = recordingPlan([MAP], [story(THREE), { ...MAP, hash: "m2" }]);
    expect(plannedMs(plan)).toBe(OPENING_MS + 3 * 1650 + STILL_VIEW_MS);
  });
});

describe("viewUrl", () => {
  it("routes to the view on the hash, its id escaped", () => {
    expect(viewUrl("file:///w/site/index.html", "a b/c")).toBe(
      "file:///w/site/index.html#/view/a%20b%2Fc/",
    );
  });
});

describe("planReport", () => {
  it("says nothing changed, and names what is gone", () => {
    expect(planReport({ views: [], removed: ["oldStory", "oldMap"] })).toBe(
      [
        "No view changed since the merge base: nothing to record.",
        "Removed since the merge base: oldStory, oldMap",
      ].join("\n"),
    );
  });

  it("lists each view it records and about how long it runs", () => {
    const plan = recordingPlan([], [story(THREE), MAP]);
    expect(planReport(plan)).toBe(
      [
        "Recording 2 views, about 13 s:",
        "  New view · aStory · A story",
        "  New view · modules · The modules",
      ].join("\n"),
    );
    expect(planReport(recordingPlan([], [MAP]))).toBe(
      [
        "Recording 1 view, about 5 s:",
        "  New view · modules · The modules",
      ].join("\n"),
    );
  });
});
