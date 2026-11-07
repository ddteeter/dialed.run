import { describe, expect, it } from "vitest";

import {
  isAlreadyInProject,
  issueNumberFromUrl,
  isRateLimited,
  neverListHits,
  parseAddedItem,
  parseIssueItem,
  parseItemsPage,
  parseProject,
  selectIssues,
  slugOf,
  statusFor,
} from "../../scripts/track/core";
import type { TrackedIssue } from "../../scripts/track/core";
import issueItems from "../fixtures/track/issue-items.json";
import shapes from "../fixtures/track/item-shapes.json";
import items from "../fixtures/track/items.json";
import project from "../fixtures/track/project.json";

// `project.json` and `items.json` are real PROJECT_QUERY and ITEMS_QUERY
// responses from the dialed.run Project, recorded 2026-11-06 (design 181;
// #357 was the round-trip issue). Re-record them with the queries in
// scripts/track/core.ts if the Project's fields change.

describe("parseProject", () => {
  const meta = parseProject(project);

  it("finds the Status and Lane fields by name", () => {
    expect(meta.id).toBe("PVT_kwHOAAUOcc4Bqjua");
    expect(meta.statusFieldId).toBe("PVTSSF_lAHOAAUOcc4Bqjuazho6Xcg");
    expect(meta.laneFieldId).toBe("PVTF_lAHOAAUOcc4Bqjuazho6XgM");
  });

  it("slugs the statuses, in the Project's order", () => {
    expect(meta.statuses.map((status) => status.slug)).toEqual([
      "inbox",
      "needs-owner",
      "needs-design",
      "ready",
      "in-lane",
      "in-pr",
      "done",
    ]);
    expect(meta.statuses[2]).toEqual({
      id: "d0703720",
      name: "Needs Design",
      slug: "needs-design",
    });
  });

  it("refuses a Project without a Status field", () => {
    const fields = project.data.user.projectV2.fields.nodes.filter(
      (field) => field.name !== "Status",
    );
    const raw = {
      data: { user: { projectV2: { id: "P", fields: { nodes: fields } } } },
    };
    expect(() => parseProject(raw)).toThrow(/no single-select "Status" field/);
  });

  it("refuses a Project without a Lane field", () => {
    const fields = project.data.user.projectV2.fields.nodes.filter(
      (field) => field.name !== "Lane",
    );
    const raw = {
      data: { user: { projectV2: { id: "P", fields: { nodes: fields } } } },
    };
    expect(() => parseProject(raw)).toThrow(/no "Lane" field/);
  });

  it("refuses a response that isn't a Project", () => {
    expect(() => parseProject({ data: { user: {} } })).toThrow();
  });
});

describe("statusFor", () => {
  const meta = parseProject(project);

  it("accepts a slug or the display name", () => {
    expect(statusFor(meta, "needs-owner").name).toBe("Needs owner");
    expect(statusFor(meta, "Needs owner").id).toBe("fc03a054");
  });

  it("names every valid slug when the status is unknown", () => {
    expect(() => statusFor(meta, "blocked")).toThrow(
      'unknown status "blocked"; one of: inbox, needs-owner, needs-design, ready, in-lane, in-pr, done',
    );
  });
});

describe("slugOf", () => {
  it("lowercases and hyphenates every run of whitespace", () => {
    expect(slugOf("  Needs   Design ")).toBe("needs-design");
    expect(slugOf("")).toBe("");
  });
});

interface PageInfo {
  readonly hasNextPage: boolean;
  readonly endCursor: unknown;
}

function pageOf(nodes: readonly unknown[], pageInfo: PageInfo): unknown {
  return { data: { node: { items: { pageInfo, nodes } } } };
}

const recorded = items.data.node.items;

describe("parseItemsPage", () => {
  it("reads a recorded page: number, title, state, url, the status's slug and the lane", () => {
    expect(parseItemsPage(items)).toEqual({
      issues: [
        {
          number: 357,
          title: "Tracker round-trip test (design 181)",
          state: "OPEN",
          url: "https://github.com/ddteeter/dialed.run/issues/357",
          status: "ready",
          lane: "w3-tracking",
        },
      ],
      next: undefined,
    });
  });

  it("gives a field never set, or set to nothing, an empty string", () => {
    const parsed = parseItemsPage(
      pageOf([shapes.unset, shapes.empty], shapes.lastPage),
    );
    expect(
      parsed.issues.map(({ number, status, lane }) => ({
        number,
        status,
        lane,
      })),
    ).toEqual([
      { number: 8, status: "", lane: "" },
      { number: 9, status: "", lane: "" },
    ]);
  });

  it("skips draft items, deleted issues and pull requests", () => {
    const nodes = [
      shapes.draft,
      shapes.deleted,
      shapes.partial,
      ...recorded.nodes,
    ];
    const parsed = parseItemsPage(pageOf(nodes, shapes.lastPage));
    expect(parsed.issues.map((issue) => issue.number)).toEqual([357]);
  });

  it("returns the cursor only while there is a next page", () => {
    const more = { hasNextPage: true, endCursor: "c2" };
    expect(parseItemsPage(pageOf([], more)).next).toBe("c2");
    expect(
      parseItemsPage(pageOf([], { ...more, hasNextPage: false })).next,
    ).toBeUndefined();
    expect(
      parseItemsPage(pageOf([], shapes.nullCursorWithNext)).next,
    ).toBeUndefined();
  });

  it("refuses a page whose nodes are not items", () => {
    expect(() =>
      parseItemsPage(pageOf([{ id: 1 }], shapes.lastPage)),
    ).toThrow();
  });
});

function trackedIssue(number: number, status: string): TrackedIssue {
  return { number, title: "", state: "OPEN", url: "", status, lane: "" };
}

describe("selectIssues", () => {
  const meta = parseProject(project);
  const issues = [
    trackedIssue(1, ""),
    trackedIssue(2, "inbox"),
    trackedIssue(3, "needs-owner"),
    trackedIssue(4, "ready"),
  ];

  it("all is everything", () => {
    expect(selectIssues(issues, meta, "all")).toBe(issues);
  });

  it("inbox is no status or Inbox", () => {
    expect(selectIssues(issues, meta, "inbox").map((i) => i.number)).toEqual([
      1, 2,
    ]);
  });

  it("a status matches by slug or display name", () => {
    expect(
      selectIssues(issues, meta, "needs-owner").map((i) => i.number),
    ).toEqual([3]);
    expect(selectIssues(issues, meta, "Ready").map((i) => i.number)).toEqual([
      4,
    ]);
  });

  it("an unknown status throws rather than listing nothing", () => {
    expect(() => selectIssues(issues, meta, "blocked")).toThrow(
      /unknown status/,
    );
  });
});

describe("parseAddedItem", () => {
  it("reads the item id", () => {
    expect(
      parseAddedItem({
        data: { addProjectV2ItemById: { item: { id: "PVTI_x" } } },
      }),
    ).toBe("PVTI_x");
  });

  it("refuses an error response", () => {
    expect(() => parseAddedItem({ errors: [{ message: "nope" }] })).toThrow();
  });
});

describe("parseIssueItem", () => {
  // issue-items.json is #358's real ISSUE_ITEMS_QUERY answer, recorded after
  // the auto-add workflow had added it.
  const projectId = project.data.user.projectV2.id;

  it("finds the issue's item in this Project", () => {
    expect(parseIssueItem(issueItems, projectId)).toEqual({
      issueId: "I_kwDOUJJKOM8AAAABdMv7sQ",
      itemId: "PVTI_lAHOAAUOcc4BqjuazhGuU48",
    });
  });

  it("has no item when the issue is only in other Projects", () => {
    expect(parseIssueItem(issueItems, "PVT_other")).toEqual({
      issueId: "I_kwDOUJJKOM8AAAABdMv7sQ",
      itemId: undefined,
    });
  });
});

describe("isAlreadyInProject", () => {
  it("recognises the duplicate-add error and nothing else", () => {
    expect(
      isAlreadyInProject(
        "gh api failed: gh: Content already exists in this project",
      ),
    ).toBe(true);
    expect(
      isAlreadyInProject("gh api failed: Could not resolve to a node"),
    ).toBe(false);
  });
});

describe("issueNumberFromUrl", () => {
  it("reads the number from gh issue create's output", () => {
    expect(
      issueNumberFromUrl("https://github.com/ddteeter/dialed.run/issues/412\n"),
    ).toBe(412);
  });

  it("refuses output without an issue URL", () => {
    expect(() =>
      issueNumberFromUrl("https://github.com/ddteeter/dialed.run/pull/9"),
    ).toThrow(
      "gh issue create did not print an issue URL: https://github.com/ddteeter/dialed.run/pull/9",
    );
  });
});

describe("neverListHits", () => {
  // Fixtures are assembled from parts so this file itself never holds a
  // string a secret scanner would flag.
  const github = ["gh", "p_", "a".repeat(36)].join("");
  const pat = ["github", "_pat_", "B".repeat(30)].join("");
  const openai = ["sk", "-", "proj", "x".repeat(24)].join("");
  const aws = ["AK", "IA", "ABCDEFGHIJKLMNOP"].join("");
  const slack = ["xo", "xb-", "1234567890ab"].join("");
  const key = ["-----BEGIN ", "RSA PRIVATE", " KEY-----"].join("");
  const jwt = [
    "ey",
    "J",
    "a".repeat(12),
    ".ey",
    "J",
    "b".repeat(12),
    ".sig",
  ].join("");

  it.each([
    ["email address", "write to runner@example.com today"],
    ["phone number", "call (555) 123-4567"],
    ["phone number", "call 555.123.4567"],
    ["phone number", "or +15551234567"],
    ["GitHub token", `token ${github}`],
    ["GitHub token", pat],
    ["API key", openai],
    ["API key", aws],
    ["API key", slack],
    ["private key", key],
    ["JWT", jwt],
  ])("catches a %s", (kind, text) => {
    expect(neverListHits(text)).toEqual([{ kind, line: 1 }]);
  });

  it("names the line of each hit, never the match", () => {
    expect(neverListHits(`fine\nmail a@b.co\nfine\ncall 555-123-4567`)).toEqual(
      [
        { kind: "email address", line: 2 },
        { kind: "phone number", line: 4 },
      ],
    );
  });

  it.each([
    "Decided 2026-11-06 (D-158), see R-74 and #412.",
    "src/modules/feed/feed.ts:1204 and docs/deferred.md:56",
    "@ddteeter owns it; [OWNER] markers stand in",
    "a 2026-11-06T12:00:00Z timestamp and version 1.2.3",
    "sk-short and ghp_short are not tokens",
  ])("leaves ordinary tracker text alone: %s", (text) => {
    expect(neverListHits(text)).toEqual([]);
  });
});

describe("isRateLimited", () => {
  it.each([
    "API rate limit exceeded for user",
    "You have exceeded a secondary rate limit",
    "was submitted too quickly",
    "triggered an abuse detection mechanism",
  ])("retries on %s", (stderr) => {
    expect(isRateLimited(stderr)).toBe(true);
  });

  it("does not retry other failures", () => {
    expect(
      isRateLimited("could not resolve to an Issue with the number of 9"),
    ).toBe(false);
  });
});
