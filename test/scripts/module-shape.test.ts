import { describe, expect, it } from "vitest";

import {
  BUDGETS,
  measureShape,
  pinsOf,
  pinsSchema,
  repinned,
  shapeProblems,
  type Pins,
  type Shape,
  type ShapeFacts,
} from "../../scripts/modules/shape";

const M = "src/modules";

/**
 * Three modules. `feed` has a sub-module, `feed/entries`, with its own
 * door; `safety` and `ops` are flat.
 */
const PATHS = [
  "src/server.ts",
  "src/routes/feed/index.tsx",
  `${M}/feed/index.ts`,
  `${M}/feed/functions.ts`,
  `${M}/feed/components/Feed.tsx`,
  `${M}/feed/redirect.ts`,
  `${M}/feed/entries/index.ts`,
  `${M}/feed/entries/retract.ts`,
  `${M}/safety/index.ts`,
  `${M}/safety/visibility.ts`,
  `${M}/ops/index.ts`,
  `${M}/ops/sentry.ts`,
];

function facts(
  imports: readonly (readonly [string, string])[],
  doors: Readonly<Record<string, readonly string[]>> = {},
): ShapeFacts {
  return {
    paths: PATHS,
    imports: imports.map(([from, to]) => ({ from, to })),
    doorNames: new Map(
      PATHS.filter((path) => path.endsWith("/index.ts")).map((path) => [
        path,
        doors[path] ?? [],
      ]),
    ),
  };
}

const CLIENT = `${M}/feed/client.ts`;
const NESTED_CLIENT = `${M}/feed/entries/client.ts`;

/**
 * `facts`, with `feed`'s client-safe door (design 255), a `client.ts` in
 * a sub-module that is no door, and a component's `.ts` helper.
 */
function withClientDoor(
  imports: readonly (readonly [string, string])[],
  clientNames: readonly string[] = [],
): ShapeFacts {
  const base = facts(imports);
  return {
    ...base,
    paths: [
      ...base.paths,
      CLIENT,
      NESTED_CLIENT,
      `${M}/feed/components/feed-rows.ts`,
    ],
    doorNames: new Map([...base.doorNames, [CLIENT, clientNames]]),
  };
}

/**
The fixture has no floor and no composers: `module-direction.test.ts` tests those.
*/
function measure(shapeFacts: ShapeFacts): Shape {
  return measureShape(shapeFacts, { composers: [], floor: [] });
}

const NO_PINS: Pins = {
  fanOut: {},
  doorWidth: {},
  pastDoor: {},
  files: {},
  parentDoor: {},
  direction: {},
  reasons: {},
};

function shapeWith(overrides: Partial<Shape>): Shape {
  return {
    fanOut: { feed: 2 },
    doorWidth: { feed: 10 },
    pastDoor: { feed: 0 },
    files: { feed: 20 },
    parentDoor: {},
    direction: { modules: 0 },
    ...overrides,
  };
}

describe("measureShape: fan-out", () => {
  it("counts each other module once, from a sub-module's files too", () => {
    const shape = measure(
      facts([
        [`${M}/feed/redirect.ts`, `${M}/safety/index.ts`],
        [`${M}/feed/functions.ts`, `${M}/safety/index.ts`],
        [`${M}/feed/entries/retract.ts`, `${M}/ops/index.ts`],
        [`${M}/feed/entries/retract.ts`, `${M}/feed/index.ts`],
        ["src/server.ts", `${M}/ops/index.ts`],
        [`${M}/ops/sentry.ts`, "src/server.ts"],
      ]),
    );

    expect(shape.fanOut).toStrictEqual({ feed: 2, ops: 0, safety: 0 });
  });
});

describe("measureShape: fan-out of the dispatch", () => {
  it("is not measured: composing every module is its job (design 261 ruling 10)", () => {
    const base = facts([[`${M}/feed/redirect.ts`, `${M}/safety/index.ts`]]);
    const withDispatch: ShapeFacts = {
      ...base,
      paths: [...base.paths, `${M}/dispatch/index.ts`, `${M}/dispatch/run.ts`],
      imports: [
        ...base.imports,
        { from: `${M}/dispatch/run.ts`, to: `${M}/feed/index.ts` },
        { from: `${M}/dispatch/run.ts`, to: `${M}/ops/index.ts` },
      ],
      doorNames: new Map([...base.doorNames, [`${M}/dispatch/index.ts`, []]]),
    };

    const shape = measure(withDispatch);

    expect(shape.fanOut).toStrictEqual({ feed: 1, ops: 0, safety: 0 });
    expect(shape.files.dispatch).toBe(2);
  });
});

describe("measureShape: parent door", () => {
  it("is the names on the door of each module that holds a sub-module, and no other", () => {
    const shape = measure(
      facts([], {
        [`${M}/feed/index.ts`]: ["a", "b"],
        [`${M}/feed/entries/index.ts`]: ["c"],
        [`${M}/safety/index.ts`]: ["d"],
      }),
    );

    expect(shape.parentDoor).toStrictEqual({ feed: 2 });
  });
});

describe("measureShape: direction", () => {
  it("is the imports to cut so that no module reaches itself", () => {
    const shape = measure(
      facts([
        [`${M}/feed/redirect.ts`, `${M}/safety/index.ts`],
        [`${M}/feed/entries/retract.ts`, `${M}/safety/index.ts`],
        [`${M}/safety/visibility.ts`, `${M}/feed/index.ts`],
      ]),
    );

    expect(shape.direction).toStrictEqual({ modules: 1 });
  });

  it("reads the lists it is given", () => {
    const cycle = facts([
      [`${M}/feed/redirect.ts`, `${M}/safety/index.ts`],
      [`${M}/safety/visibility.ts`, `${M}/feed/entries/index.ts`],
    ]);

    expect(measure(cycle).direction).toStrictEqual({ modules: 1 });
    expect(
      measureShape(cycle, { composers: [], floor: ["feed/entries"] })
        .direction,
    ).toStrictEqual({ modules: 0 });
  });
});

describe("measureShape: door width", () => {
  it("is the names each index.ts exports, a sub-module's under its own name", () => {
    const shape = measure(
      facts([], {
        [`${M}/feed/index.ts`]: ["a", "b"],
        [`${M}/feed/entries/index.ts`]: ["c"],
      }),
    );

    expect(shape.doorWidth).toStrictEqual({
      feed: 2,
      "feed/entries": 1,
      ops: 0,
      safety: 0,
    });
  });

  it("counts a module's client.ts as a door of its own, by its path", () => {
    const shape = measure(withClientDoor([], ["x", "y", "z"]));

    expect(shape.doorWidth).toStrictEqual({
      feed: 0,
      "feed/client.ts": 3,
      "feed/entries": 0,
      ops: 0,
      safety: 0,
    });
  });

  it("refuses a door nobody read, rather than counting it as empty", () => {
    const unread = { ...facts([]), doorNames: new Map<string, string[]>() };

    expect(() => measure(unread)).toThrow(
      new Error(`${M}/feed/entries/index.ts was not read`),
    );
  });
});

describe("measureShape: past the door", () => {
  it("counts an import from outside the module to a file that is no door", () => {
    const shape = measure(
      facts([
        ["src/server.ts", `${M}/feed/entries/retract.ts`],
        [`${M}/safety/visibility.ts`, `${M}/feed/redirect.ts`],
        ["src/server.ts", `${M}/ops/sentry.ts`],
      ]),
    );

    expect(shape.pastDoor).toStrictEqual({ feed: 2, ops: 1, safety: 0 });
  });

  it("does not count a door, the module's own or a sub-module's", () => {
    const shape = measure(
      facts([
        ["src/server.ts", `${M}/feed/index.ts`],
        ["src/server.ts", `${M}/feed/entries/index.ts`],
        [`${M}/safety/visibility.ts`, `${M}/feed/entries/index.ts`],
      ]),
    );

    expect(shape.pastDoor.feed).toBe(0);
  });

  it("counts a route's import of a file that is no door (design 255)", () => {
    const shape = measure(
      facts([
        ["src/routes/feed/index.tsx", `${M}/feed/redirect.ts`],
        ["src/routes/feed/index.tsx", `${M}/feed/entries/retract.ts`],
      ]),
    );

    expect(shape.pastDoor.feed).toBe(2);
  });

  it("does not count a module's client.ts, nor a helper in a components/ folder", () => {
    const shape = measure(
      withClientDoor([
        ["src/routes/feed/index.tsx", CLIENT],
        ["src/routes/feed/index.tsx", `${M}/feed/components/feed-rows.ts`],
        [`${M}/safety/visibility.ts`, CLIENT],
      ]),
    );

    expect(shape.pastDoor.feed).toBe(0);
  });

  it("counts a client.ts deeper than a module's own folder as a plain file", () => {
    const shape = measure(
      withClientDoor([["src/routes/feed/index.tsx", NESTED_CLIENT]]),
    );

    expect(shape.pastDoor.feed).toBe(1);
  });

  it("does not count wiring, nor the module's own", () => {
    const shape = measure(
      facts([
        ["src/server.ts", `${M}/feed/functions.ts`],
        ["src/server.ts", `${M}/feed/components/Feed.tsx`],
        [`${M}/feed/functions.ts`, `${M}/feed/entries/retract.ts`],
        [`${M}/feed/redirect.ts`, "src/server.ts"],
      ]),
    );

    expect(shape.pastDoor.feed).toBe(0);
  });
});

describe("measureShape: files", () => {
  it("counts a file for the deepest unit that holds it", () => {
    const shape = measure(facts([]));

    expect(shape.files).toStrictEqual({
      feed: 4,
      "feed/entries": 2,
      ops: 2,
      safety: 2,
    });
  });

  it("refuses a file in a folder with no index.ts above it", () => {
    const stray = { ...facts([]), paths: [...PATHS, `${M}/stray/thing.ts`] };

    expect(() => measure(stray)).toThrow(
      new Error(
        `${M}/stray/thing.ts is in no module: its folder has no index.ts`,
      ),
    );
  });
});

describe("pinsOf", () => {
  it("keeps a number over its budget and drops one at it", () => {
    const shape = shapeWith({
      fanOut: { feed: BUDGETS.fanOut + 1, ops: BUDGETS.fanOut },
      doorWidth: { feed: BUDGETS.doorWidth, safety: BUDGETS.doorWidth + 1 },
      pastDoor: { feed: BUDGETS.pastDoor, ops: BUDGETS.pastDoor + 1 },
      files: { feed: BUDGETS.files + 1, ops: BUDGETS.files },
    });

    expect(pinsOf(shape)).toStrictEqual({
      fanOut: { feed: BUDGETS.fanOut + 1 },
      doorWidth: { safety: BUDGETS.doorWidth + 1 },
      pastDoor: { ops: BUDGETS.pastDoor + 1 },
      files: { feed: BUDGETS.files + 1 },
      parentDoor: {},
      direction: {},
      reasons: {},
    });
  });

  it("reads each kind against its own budget", () => {
    const shape = shapeWith({
      fanOut: { feed: 3 },
      doorWidth: { feed: 3 },
      pastDoor: { feed: 3 },
      files: { feed: 3 },
    });
    const budgets = {
      fanOut: 2,
      doorWidth: 3,
      pastDoor: 4,
      files: 5,
      parentDoor: 6,
      direction: 7,
    };

    expect(pinsOf(shape, budgets)).toStrictEqual({
      ...NO_PINS,
      fanOut: { feed: 3 },
    });
  });
});

describe("pinsOf: parent doors and the direction", () => {
  it("pins every parent door and any direction over 0", () => {
    const shape = shapeWith({
      parentDoor: { feed: 1 },
      direction: { modules: 1 },
    });

    expect(pinsOf(shape)).toStrictEqual({
      ...NO_PINS,
      parentDoor: { feed: 1 },
      direction: { modules: 1 },
    });
    expect(BUDGETS.parentDoor).toBe(0);
    expect(BUDGETS.direction).toBe(0);
  });
});

describe("shapeProblems", () => {
  const REMEDY =
    "Bring it back down, or propose a sub-module (design 240, CLAUDE.md); " +
    "a pin is raised or added only on the owner's say, by hand in " +
    "test/architecture/module-shape.json.";
  const LOWER = "Run `npm run modules:pin` and commit the result.";

  it("has none when every number is within budget and nothing is pinned", () => {
    expect(shapeProblems(shapeWith({}), NO_PINS)).toStrictEqual([]);
  });

  it("lets a number sit at its budget, and at its pin", () => {
    const shape = shapeWith({ fanOut: { feed: BUDGETS.fanOut, ops: 9 } });

    expect(
      shapeProblems(shape, { ...NO_PINS, fanOut: { ops: 9 } }),
    ).toStrictEqual([]);
  });

  it("fails a number over budget that nothing pins", () => {
    const shape = shapeWith({ fanOut: { feed: 8 } });

    expect(shapeProblems(shape, NO_PINS)).toStrictEqual([
      `feed: the modules it imports (fanOut) is 8, over the budget of 7, and not pinned. ${REMEDY}`,
    ]);
  });

  it("fails a pinned number that rose", () => {
    const shape = shapeWith({ doorWidth: { safety: 225 } });

    expect(
      shapeProblems(shape, { ...NO_PINS, doorWidth: { safety: 224 } }),
    ).toStrictEqual([
      `safety: the names its door exports (doorWidth) rose from 224 to 225. ${REMEDY}`,
    ]);
  });

  it("fails a pinned number that fell until the pin is lowered", () => {
    const shape = shapeWith({ pastDoor: { account: 4 } });

    expect(
      shapeProblems(shape, { ...NO_PINS, pastDoor: { account: 5 } }),
    ).toStrictEqual([
      `account: the imports that go around its doors (pastDoor) fell from 5 to 4: lower the pin so it cannot rise again. ${LOWER}`,
    ]);
  });

  it("fails a pin left on a number that reached its budget", () => {
    const shape = shapeWith({ files: { feed: 50 } });

    expect(
      shapeProblems(shape, { ...NO_PINS, files: { feed: 50 } }),
    ).toStrictEqual([
      `feed: the files in its folder (files) is pinned at 50, which is within the budget of 50: the pin is done. ${LOWER}`,
    ]);
  });

  it("fails a pin on a unit that is gone", () => {
    expect(
      shapeProblems(shapeWith({}), { ...NO_PINS, files: { gone: 60 } }),
    ).toStrictEqual([
      `gone: files is pinned, and no such unit is left. ${LOWER}`,
    ]);
  });

  it("reads each kind against its own pins and its own budget", () => {
    const shape = shapeWith({
      fanOut: { feed: 3 },
      doorWidth: { feed: 3 },
      pastDoor: { feed: 3 },
      files: { feed: 3 },
    });
    const budgets = {
      fanOut: 9,
      doorWidth: 9,
      pastDoor: 2,
      files: 9,
      parentDoor: 9,
      direction: 9,
    };
    const pins = { ...NO_PINS, files: { feed: 2 } };

    expect(shapeProblems(shape, pins, budgets)).toStrictEqual([
      `feed: the imports that go around its doors (pastDoor) is 3, over the budget of 2, and not pinned. ${REMEDY}`,
      `feed: the files in its folder (files) rose from 2 to 3. ${REMEDY}`,
    ]);
  });
});

describe("shapeProblems: the new kinds and the reasons", () => {
  const OWNER_ONLY =
    "a pin is raised or added only on the owner's say, by hand in " +
    "test/architecture/module-shape.json.";
  const LOWER = "Run `npm run modules:pin` and commit the result.";

  it("asks for a pin on a module split for the first time", () => {
    const shape = shapeWith({ parentDoor: { feed: 3 } });

    expect(shapeProblems(shape, NO_PINS)).toStrictEqual([
      `feed: the names its parent door exports (parentDoor) is 3, over the budget of 0, and not pinned. A module split for the first time is pinned where it stands. ${LOWER}`,
    ]);
  });

  it("sends a parent door that rose to the sub-module's door", () => {
    const shape = shapeWith({ parentDoor: { feed: 4 } });

    expect(
      shapeProblems(shape, { ...NO_PINS, parentDoor: { feed: 3 } }),
    ).toStrictEqual([
      `feed: the names its parent door exports (parentDoor) rose from 3 to 4. Export the name from the sub-module's door, and import it from there (design 240 rule 4); ${OWNER_ONLY}`,
    ]);
  });

  it("names the remedy when the direction rises, and lets it sit at its pin", () => {
    const shape = shapeWith({ direction: { modules: 4 } });

    expect(
      shapeProblems(shape, { ...NO_PINS, direction: { modules: 3 } }),
    ).toStrictEqual([
      "modules: the imports to cut so that no module reaches itself (direction) rose from 3 to 4. " +
        "Cut the import: move the code to the module below, or hand the function in from a " +
        "functions.ts (docs/architecture.md, Composing across modules). " +
        `\`npm run modules:pin -- --print\` names the imports to cut; ${OWNER_ONLY}`,
    ]);
    expect(
      shapeProblems(shape, { ...NO_PINS, direction: { modules: 4 } }),
    ).toStrictEqual([]);
  });

  it("refuses a direction over 0 that nothing pins, on the owner's say", () => {
    const shape = shapeWith({ direction: { modules: 1 } });

    expect(shapeProblems(shape, NO_PINS)).toStrictEqual([
      expect.stringMatching(
        /^modules: .* \(direction\) is 1, over the budget of 0, and not pinned\. Cut the import/u,
      ),
    ]);
  });

  it("lets a reason sit beside its pin, and fails one whose pin is gone", () => {
    const shape = shapeWith({ fanOut: { feed: 9 } });
    const pins: Pins = {
      ...NO_PINS,
      fanOut: { feed: 9 },
      reasons: { fanOut: { feed: "a ceiling" }, files: { feed: "gone" } },
    };

    expect(shapeProblems(shape, pins)).toStrictEqual([
      `feed: the reason for its files pin is left, and the pin is not. ${LOWER}`,
    ]);
  });
});

describe("repinned", () => {
  const OVER = shapeWith({ fanOut: { feed: 9, ops: 8 } });

  it("writes the first set when there are no pins yet", () => {
    expect(repinned(OVER, undefined)).toStrictEqual({
      ...NO_PINS,
      fanOut: { feed: 9, ops: 8 },
    });
  });

  it("lowers a pin, keeps one that held, and drops one that reached budget", () => {
    const pins = { ...NO_PINS, fanOut: { feed: 10, ops: 8, safety: 8 } };
    const shape = shapeWith({ fanOut: { feed: 9, ops: 8, safety: 7 } });

    expect(repinned(shape, pins)).toStrictEqual({
      ...NO_PINS,
      fanOut: { feed: 9, ops: 8 },
    });
  });

  it("refuses to raise a pin", () => {
    const pins = { ...NO_PINS, fanOut: { feed: 8, ops: 8 } };

    expect(() => repinned(OVER, pins)).toThrow(
      /^feed: the modules it imports \(fanOut\) is 9, and is pinned at 8\nBring it back down/u,
    );
  });

  it("refuses to add a pin where there was none", () => {
    const pins = { ...NO_PINS, fanOut: { feed: 9 } };

    expect(() => repinned(OVER, pins)).toThrow(
      /^ops: the modules it imports \(fanOut\) is 8, and is pinned at nothing\n/u,
    );
  });

  it("names every pin it would raise, across kinds", () => {
    const shape = shapeWith({ fanOut: { feed: 9 }, files: { feed: 60 } });
    const pins = { ...NO_PINS, fanOut: { feed: 8 }, files: { feed: 59 } };

    expect(() => repinned(shape, pins)).toThrow(
      /pinned at 8\nfeed: the files in its folder \(files\) is 60, and is pinned at 59\n/u,
    );
  });
});

describe("repinned: parent doors and reasons", () => {
  it("adds a parent-door pin where there was none, and only that kind", () => {
    const split = shapeWith({ parentDoor: { feed: 5 } });

    expect(repinned(split, NO_PINS)).toStrictEqual({
      ...NO_PINS,
      parentDoor: { feed: 5 },
    });
    expect(() =>
      repinned(shapeWith({ direction: { modules: 1 } }), NO_PINS),
    ).toThrow(/^modules: .* \(direction\) is 1, and is pinned at nothing\n/u);
  });

  it("refuses to raise a parent-door pin", () => {
    const pins = { ...NO_PINS, parentDoor: { feed: 4 } };

    expect(() =>
      repinned(shapeWith({ parentDoor: { feed: 5 } }), pins),
    ).toThrow(/^feed: .* \(parentDoor\) is 5, and is pinned at 4\n/u);
  });

  it("keeps a reason while its pin stays, and drops it with the pin", () => {
    const pins: Pins = {
      ...NO_PINS,
      fanOut: { feed: 10, ops: 9 },
      reasons: { fanOut: { feed: "a ceiling", ops: "another" } },
    };
    const shape = shapeWith({ fanOut: { feed: 9, ops: 7 } });

    expect(repinned(shape, pins)).toStrictEqual({
      ...NO_PINS,
      fanOut: { feed: 9 },
      reasons: { fanOut: { feed: "a ceiling" } },
    });
  });

  it("drops a kind whose reasons are all gone", () => {
    const pins: Pins = {
      ...NO_PINS,
      files: { feed: 60 },
      reasons: { files: { feed: "gone soon" } },
    };

    expect(repinned(shapeWith({}), pins).reasons).toStrictEqual({});
  });
});

describe("pinsSchema", () => {
  it("reads the file's shape and refuses anything else in it", () => {
    expect(pinsSchema.parse(NO_PINS)).toStrictEqual(NO_PINS);
    expect(pinsSchema.safeParse({ ...NO_PINS, lines: {} }).success).toBe(false);
    expect(
      pinsSchema.safeParse({ ...NO_PINS, files: { feed: 0 } }).success,
    ).toBe(false);
    expect(
      pinsSchema.safeParse({ ...NO_PINS, files: { feed: 1.5 } }).success,
    ).toBe(false);
    expect(
      pinsSchema.safeParse({ ...NO_PINS, reasons: { lines: { feed: "x" } } })
        .success,
    ).toBe(false);
    expect(
      pinsSchema.safeParse({ ...NO_PINS, reasons: { fanOut: { feed: "" } } })
        .success,
    ).toBe(false);
    expect(
      pinsSchema.parse({ ...NO_PINS, reasons: { fanOut: { feed: "why" } } })
        .reasons,
    ).toStrictEqual({ fanOut: { feed: "why" } });
  });
});
