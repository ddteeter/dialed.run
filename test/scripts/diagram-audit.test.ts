import { describe, expect, it } from "vitest";

import type { Story } from "../../scripts/diagrams/anchors";
import {
  auditTitle,
  briefText,
  DUE_AFTER_REREADS,
  dueFlows,
  dueReport,
  framesOf,
  joinSteps,
  rereadViews,
  storyText,
  type AuditView,
  type Edge,
  type ElementFacts,
  type MergedPr,
} from "../../scripts/diagrams/audit";

function edge(id: string, label: string, extra: Partial<Edge> = {}): Edge {
  return {
    id,
    source: "a",
    target: "b",
    kind: "",
    label,
    notes: "",
    navigateTo: "",
    ...extra,
  };
}

describe("framesOf", () => {
  it("gives each step the frames around it, outermost first", () => {
    const frames = framesOf([
      "step-01",
      {
        _type: "try",
        flow: [
          { _type: "try-block", flow: ["step-02"] },
          { _type: "try-catch", title: "it is lost", flow: ["step-03"] },
          { _type: "try-finally", flow: ["step-09"] },
        ],
      },
      {
        _type: "loop",
        title: "again",
        flow: [{ _type: "opt", title: "sometimes", flow: ["step-04"] }],
      },
      { _type: "par", flow: ["step-05"] },
      {
        _type: "alt",
        flow: [
          { _type: "alt-if", title: "yes", flow: ["step-06"] },
          { _type: "alt-when", title: "maybe", flow: ["step-07"] },
          { _type: "alt-else", flow: ["step-08"] },
        ],
      },
      { _type: "break", title: "it is done", flow: ["step-10"] },
    ]);

    expect([...frames]).toStrictEqual([
      ["step-01", []],
      ["step-02", ["try"]],
      ["step-03", ["catch 'it is lost'"]],
      ["step-09", ["finally"]],
      ["step-04", ["loop 'again'", "opt 'sometimes'"]],
      ["step-05", ["parallel"]],
      ["step-06", ["if 'yes'"]],
      ["step-07", ["when 'maybe'"]],
      ["step-08", ["else"]],
      ["step-10", ["break 'it is done'"]],
    ]);
  });

  it("throws on a frame it does not know, rather than dropping it", () => {
    expect(() => framesOf([{ _type: "critical", flow: ["step-01"] }])).toThrow(
      "scripts/diagrams/audit.ts does not know the frame critical: add it to FRAME_WORDS.",
    );
  });
});

const STORY: Story = {
  view: "aStory",
  file: "flows/a.c4",
  steps: [
    { line: 3, cites: [{ path: "src/a.ts", symbols: ["f"] }] },
    { line: 5, cites: undefined },
    { line: 7, cites: [{ path: "src/b.ts", symbols: ["g", "h"] }] },
  ],
};

const IN_FLOW = new Map<string, readonly string[]>([
  ["s1", []],
  ["s2", []],
  ["s3", []],
  ["s4", ["opt 'later'"]],
]);

describe("joinSteps", () => {
  it("gives each arrow its statement's source comment, a chain's two arrows the same one", () => {
    const steps = joinSteps(
      STORY,
      [1, 2, 1],
      [
        edge("s1", "one"),
        edge("s2", "two"),
        edge("s3", "three"),
        edge("s4", "four"),
      ],
      IN_FLOW,
    );

    expect(
      steps.map((step) => [step.id, step.label, step.cites, step.frames]),
    ).toStrictEqual([
      ["s1", "one", [{ path: "src/a.ts", symbols: ["f"] }], []],
      ["s2", "two", undefined, []],
      ["s3", "three", undefined, []],
      [
        "s4",
        "four",
        [{ path: "src/b.ts", symbols: ["g", "h"] }],
        ["opt 'later'"],
      ],
    ]);
  });

  it("throws when the arrows LikeC4 computed are not the ones the statements draw", () => {
    const edges = [edge("s1", "one"), edge("s2", "two"), edge("s3", "three")];

    expect(() => joinSteps(STORY, [1, 1, 2], edges, IN_FLOW)).toThrow(
      "aStory: 3 statements drawing 4 arrows, but LikeC4 computed 3",
    );
    expect(() => joinSteps(STORY, [1, 2], edges, IN_FLOW)).toThrow(
      "aStory: 3 statements drawing 3 arrows, but LikeC4 computed 3",
    );
  });

  it("throws on an arrow that is not in the view's flow", () => {
    expect(() =>
      joinSteps(
        STORY,
        [1, 1, 1],
        [edge("s1", "one"), edge("s2", "two"), edge("s9", "nine")],
        IN_FLOW,
      ),
    ).toThrow("aStory: the arrow s9 is not in the view's flow.");
  });
});

function element(
  id: string,
  title: string,
  extra: Partial<ElementFacts> = {},
): ElementFacts {
  return { id, kind: "e", title, technology: "", description: "", ...extra };
}

const VIEWS: AuditView[] = [
  {
    view: "aStory",
    file: "flows/a.c4",
    title: "A thing happens",
    steps: [
      {
        ...edge("s1", "asks for it", { source: "runner", target: "cf.app.a" }),
        frames: [],
        cites: [
          { path: "src/a.ts", symbols: ["f", "g"], note: "the key lookup" },
          { path: "wrangler.jsonc", symbols: ["queues.consumers"] },
        ],
      },
      {
        ...edge("s2", "sends the job", {
          kind: "async",
          notes: "\n  **Guard: a key.** One line.\n\n  Another paragraph.\n",
          navigateTo: "aRecovery",
        }),
        frames: ["loop 'again'", "opt 'sometimes'"],
        cites: undefined,
      },
    ],
    elements: [
      element("runner", "Runner", { description: "Logs runs" }),
      element("cf.app.a", "f", {
        kind: "inRequest",
        technology: " in the request ",
      }),
      element("b", "B"),
    ],
  },
  {
    view: "aRecovery",
    file: "flows/a.c4",
    title: "When it is lost",
    steps: [
      {
        ...edge("s1", "re-drives it", { kind: "recovery" }),
        frames: [],
        cites: [{ path: "src/c.ts", symbols: ["redrive"] }],
      },
    ],
    elements: [
      element("runner", "Runner", { description: "Logs runs" }),
      element("cf.db", "D1", { description: "The row is the marker" }),
    ],
  },
  {
    view: "aWeather",
    file: "flows/a.c4",
    title: "It gets its weather",
    steps: [
      {
        ...edge("s1", "attaches", { source: "cf.app.a", target: "w" }),
        frames: [],
        cites: [{ path: "src/w.ts", symbols: ["attach"] }],
      },
    ],
    elements: [],
  },
];

describe("storyText", () => {
  it("numbers each view's arrows, with frames, source, link and notes, then the elements' words and the other flows", () => {
    expect(
      storyText(VIEWS.slice(0, 2), [
        { view: "bStory", title: "Another thing", file: "flows/b.c4" },
      ]),
    ).toBe(
      [
        "## aStory: A thing happens",
        "",
        "1. runner -> cf.app.a: asks for it",
        "   source: src/a.ts f, g (the key lookup); wrangler.jsonc queues.consumers",
        "2. a -[async]-> b: sends the job",
        "   in: loop 'again' > opt 'sometimes'",
        "   source: (no source comment)",
        "   opens: aRecovery",
        "   notes:",
        "     **Guard: a key.** One line.",
        "",
        "     Another paragraph.",
        "",
        "## aRecovery: When it is lost",
        "",
        "1. a -[recovery]-> b: re-drives it",
        "   source: src/c.ts redrive",
        "",
        "## The elements, as these views describe them",
        "",
        "- runner (e): Runner. Logs runs",
        "- cf.app.a (inRequest): f. in the request",
        "- cf.db (e): D1. The row is the marker",
        "",
        "## Other flows' stories",
        "",
        "- bStory: Another thing (flows/b.c4)",
      ].join("\n"),
    );
  });

  it("says when no other flow has a story", () => {
    expect(storyText(VIEWS.slice(2), [])).toContain(
      "## Other flows' stories\n\n(none)",
    );
  });
});

describe("briefText", () => {
  const elements = [
    element("runner", "Runner", { kind: "actor", description: "Logs runs" }),
    element("cf.app.a", "f", {
      kind: "inRequest",
      technology: "in the request",
    }),
  ];

  it("gives each story's title and first step, skipping recovery views, and the element ids", () => {
    expect(briefText(VIEWS, elements)).toBe(
      [
        "The flow starts at each of these. Derive from every one:",
        "",
        "1. A thing happens",
        "   It starts with: runner -> cf.app.a: asks for it",
        "   In the code: src/a.ts f, g; wrangler.jsonc queues.consumers",
        "2. It gets its weather",
        "   It starts with: cf.app.a -> w: attaches",
        "   In the code: src/w.ts attach",
        "",
        "Elements of the model, by id. Name a step's two ends with these; when nothing fits, say so:",
        "",
        "- runner (actor): Runner",
        "- cf.app.a (inRequest): f",
      ].join("\n"),
    );
  });

  it("says nothing past each first step, no note and no element's words", () => {
    const brief = briefText(VIEWS, elements);

    for (const said of [
      "sends the job",
      "Guard",
      "When it is lost",
      "re-drives",
      "the key lookup",
      "Logs runs",
      "in the request",
    ]) {
      expect(brief).not.toContain(said);
    }
  });

  it("throws on a flow with no story step to start from", () => {
    const message = "A flow to audit needs a story with at least one step.";

    expect(() => briefText([], elements)).toThrow(message);
    expect(() =>
      briefText(
        [{ view: "v", file: "f", title: "t", steps: [], elements: [] }],
        elements,
      ),
    ).toThrow(message);
    expect(() => briefText(VIEWS.slice(1, 2), elements)).toThrow(message);
  });
});

const VIEW_NAMES = [
  "importStory",
  "importRecovery",
  "enrichmentStory",
  "aStory",
  "bStory",
  "weatherStory",
];

describe("rereadViews", () => {
  it("reads only the Diagrams section, and only lines that say re-read", () => {
    const body = [
      "## Summary",
      "",
      "- `importStory`: re-read, mentioned outside the section",
      "",
      "## Diagrams",
      "",
      "- `importStory`, `importRecovery`: re-read, still hold.",
      "- `weatherStory`: updated.",
      "- `enrichmentStory`: updated. Reread the rest.",
      "### Notes",
      "- aStory: RE-READ, a bare name under a deeper heading.",
      "## Deferred",
      "- `bStory`: re-read",
    ].join("\n");

    expect([...rereadViews(body, VIEW_NAMES)]).toStrictEqual([
      "importStory",
      "importRecovery",
      "enrichmentStory",
      "aStory",
    ]);
  });

  it("takes a bold Diagrams line as the heading, CRLF lines, and whole names only", () => {
    const body = [
      "**Diagrams**",
      "- importStoryline: re-read",
      "- bStory re-read; aStoryX too",
      "# Next",
      "- aStory: re-read",
    ].join("\r\n");

    expect([...rereadViews(body, VIEW_NAMES)]).toStrictEqual(["bStory"]);
  });

  it("finds nothing in a body with no Diagrams section", () => {
    expect(rereadViews("- `aStory`: re-read", VIEW_NAMES).size).toBe(0);
  });
});

function pr(number: number, mergedAt: string, views: string[]): MergedPr {
  return {
    number,
    mergedAt,
    body: [
      "## Diagrams",
      ...views.map((view) => `- \`${view}\`: re-read, still holds`),
    ].join("\n"),
  };
}

const STORIES = [
  { view: "aStory", file: "flows/a.c4" },
  { view: "aRecovery", file: "flows/a.c4" },
  { view: "bStory", file: "flows/b.c4" },
  { view: "cStory", file: "flows/c.c4" },
];

function record(
  file: string,
  day: string,
): { title: string; createdAt: string } {
  return { title: auditTitle(file, day), createdAt: `${day}T00:00:00Z` };
}

describe("dueFlows", () => {
  it("is due when never audited, counting each PR once for the flow", () => {
    const { flows } = dueFlows(
      STORIES.slice(0, 3),
      [pr(12, "2026-11-02T00:00:00Z", ["aStory", "aRecovery"])],
      [],
    );

    expect(flows).toStrictEqual([
      { file: "flows/a.c4", lastAudit: undefined, rereads: [12], due: true },
      { file: "flows/b.c4", lastAudit: undefined, rereads: [], due: true },
    ]);
  });

  it("counts only the PRs merged since the flow's latest audit, never audited first", () => {
    const audits = [
      record("flows/a.c4", "2026-11-01"),
      record("flows/a.c4", "2026-11-05"),
      record("flows/b.c4", "2026-11-03"),
    ];
    const prs = [
      pr(1, "2026-11-04T00:00:00Z", ["aStory", "bStory"]),
      pr(2, "2026-11-06T00:00:00Z", ["aStory"]),
      pr(3, "2026-11-07T00:00:00Z", ["bStory"]),
      pr(4, "2026-11-08T00:00:00Z", ["aRecovery"]),
      pr(5, "2026-11-08T00:00:00Z", ["dStory"]),
    ];

    expect(dueFlows(STORIES, prs, audits).flows).toStrictEqual([
      { file: "flows/c.c4", lastAudit: undefined, rereads: [], due: true },
      {
        file: "flows/b.c4",
        lastAudit: "2026-11-03T00:00:00Z",
        rereads: [1, 3],
        due: false,
      },
      {
        file: "flows/a.c4",
        lastAudit: "2026-11-05T00:00:00Z",
        rereads: [2, 4],
        due: false,
      },
    ]);
  });

  it(`is due at ${String(DUE_AFTER_REREADS)} re-reads since the last audit, not before`, () => {
    const audits = [record("flows/b.c4", "2026-11-01")];
    const prs = [
      pr(9, "2026-11-02T00:00:00Z", ["bStory"]),
      pr(7, "2026-11-03T00:00:00Z", ["bStory"]),
    ];
    const stories = STORIES.slice(2, 3);

    expect(dueFlows(stories, prs, audits).flows[0]?.due).toBe(false);
    expect(
      dueFlows(
        stories,
        [...prs, pr(8, "2026-11-04T00:00:00Z", ["bStory"])],
        audits,
      ).flows[0],
    ).toStrictEqual({
      file: "flows/b.c4",
      lastAudit: "2026-11-01T00:00:00Z",
      rereads: [7, 8, 9],
      due: true,
    });
  });

  it("lists the records it cannot count, and ignores other titles", () => {
    const audits = [
      record("flows/a.c4", "2026-11-01"),
      { title: "Diagram audit: flows/b.c4", createdAt: "2026-11-02T00:00:00Z" },
      record("a.c4", "2026-11-03"),
      {
        title: "Design 229: step 5, skill diagram-audit",
        createdAt: "2026-11-02T00:00:00Z",
      },
    ];

    const due = dueFlows(STORIES.slice(0, 3), [], audits);

    expect(due.strays).toStrictEqual([
      "Diagram audit: flows/b.c4",
      "Diagram audit: a.c4 (2026-11-03)",
    ]);
    expect(due.flows.map((flow) => [flow.file, flow.lastAudit])).toStrictEqual([
      ["flows/b.c4", undefined],
      ["flows/a.c4", "2026-11-01T00:00:00Z"],
    ]);
  });
});

describe("dueReport", () => {
  it("lists the flows due with their record titles, then the rest, then the strays", () => {
    expect(
      dueReport(
        {
          flows: [
            {
              file: "flows/a.c4",
              lastAudit: undefined,
              rereads: [3],
              due: true,
            },
            {
              file: "flows/c.c4",
              lastAudit: undefined,
              rereads: [4, 5],
              due: true,
            },
            {
              file: "flows/b.c4",
              lastAudit: "2026-11-03T10:00:00Z",
              rereads: [],
              due: false,
            },
          ],
          strays: ["Diagram audit: flows/b.c4"],
        },
        "2026-11-17",
      ),
    ).toBe(
      [
        `Due a diagram audit (never audited, or re-read in ${String(DUE_AFTER_REREADS)}+ merged PRs since the last):`,
        "- flows/a.c4: never audited; re-read in 1 PR since (#3)",
        "  record: Diagram audit: flows/a.c4 (2026-11-17)",
        "- flows/c.c4: never audited; re-read in 2 PRs since (#4, #5)",
        "  record: Diagram audit: flows/c.c4 (2026-11-17)",
        "",
        "Not due:",
        "- flows/b.c4: last audited 2026-11-03; no re-read since",
        "",
        "Records that name no flow file, or not as `Diagram audit: <flow file> (<YYYY-MM-DD>)`; fix their titles, or the count ignores them:",
        "- Diagram audit: flows/b.c4",
      ].join("\n"),
    );
  });

  it("says when no flow is due", () => {
    const flows = [
      {
        file: "flows/b.c4",
        lastAudit: "2026-11-03T10:00:00Z",
        rereads: [],
        due: false,
      },
    ];

    expect(dueReport({ flows, strays: [] }, "2026-11-17")).toBe(
      [
        "No flow is due a diagram audit.",
        "",
        "Not due:",
        "- flows/b.c4: last audited 2026-11-03; no re-read since",
      ].join("\n"),
    );
    expect(dueReport({ flows: [], strays: [] }, "2026-11-17")).toBe(
      "No flow is due a diagram audit.",
    );
  });
});

describe("auditTitle", () => {
  it("names the flow file and the date", () => {
    expect(auditTitle("docs/diagrams/flows/import.c4", "2026-11-17")).toBe(
      "Diagram audit: docs/diagrams/flows/import.c4 (2026-11-17)",
    );
  });
});
