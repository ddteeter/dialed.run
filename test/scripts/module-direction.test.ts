import { describe, expect, it } from "vitest";

import {
  DIRECTION_LISTS,
  directionOf,
  type DirectionLists,
} from "../../scripts/modules/direction";

const M = "src/modules";

/**
 * Five modules, `ops` with a floor unit and a sub-module that is not one,
 * and a composer, `dispatch`, with a unit of its own inside it.
 */
const FOLDERS = [
  `${M}/dispatch/jobs`,
  `${M}/ops/desk`,
  `${M}/ops/outbox`,
  `${M}/dispatch`,
  `${M}/feed`,
  `${M}/ops`,
  `${M}/runs`,
  `${M}/safety`,
];
const LISTS: DirectionLists = {
  composers: ["dispatch"],
  floor: ["ops/outbox"],
};

function direction(
  imports: readonly (readonly [string, string])[],
  lists: DirectionLists = LISTS,
): ReturnType<typeof directionOf> {
  return directionOf(
    imports.map(([from, to]) => ({ from, to })),
    FOLDERS,
    lists,
  );
}

describe("directionOf", () => {
  it("is 0 when the modules have one order", () => {
    expect(
      direction([
        [`${M}/feed/a.ts`, `${M}/safety/index.ts`],
        [`${M}/safety/b.ts`, `${M}/ops/index.ts`],
        [`${M}/feed/a.ts`, `${M}/ops/index.ts`],
      ]),
    ).toStrictEqual({ cuts: 0, pairs: [] });
  });

  it("cuts the smaller side of two modules that import each other, and names its imports", () => {
    const result = direction([
      [`${M}/feed/a.ts`, `${M}/safety/index.ts`],
      [`${M}/feed/b.ts`, `${M}/safety/index.ts`],
      [`${M}/safety/c.ts`, `${M}/feed/index.ts`],
    ]);

    expect(result).toStrictEqual({
      cuts: 1,
      pairs: [
        {
          from: "safety",
          to: "feed",
          imports: [{ from: `${M}/safety/c.ts`, to: `${M}/feed/index.ts` }],
        },
      ],
    });
  });

  it("cuts the one import that breaks a cycle of three", () => {
    const result = direction([
      [`${M}/feed/a.ts`, `${M}/safety/index.ts`],
      [`${M}/feed/a2.ts`, `${M}/safety/index.ts`],
      [`${M}/safety/b.ts`, `${M}/runs/index.ts`],
      [`${M}/safety/b2.ts`, `${M}/runs/index.ts`],
      [`${M}/runs/c.ts`, `${M}/feed/index.ts`],
    ]);

    expect(result.cuts).toBe(1);
    expect(result.pairs.map(({ from, to }) => `${from} ${to}`)).toStrictEqual([
      "runs feed",
    ]);
  });

  it("adds up the groups that do not reach each other, sorted by pair", () => {
    const result = direction([
      [`${M}/safety/a.ts`, `${M}/runs/index.ts`],
      [`${M}/runs/b.ts`, `${M}/safety/index.ts`],
      [`${M}/feed/c.ts`, `${M}/ops/index.ts`],
      [`${M}/ops/d.ts`, `${M}/feed/index.ts`],
    ]);

    expect(result.cuts).toBe(2);
    expect(result.pairs.map(({ from, to }) => `${from} ${to}`)).toStrictEqual([
      "feed ops",
      "runs safety",
    ]);
  });

  it("cuts the one link two cycles share, not each cycle's own", () => {
    // feed -> safety -> runs -> feed and feed -> safety -> runs -> ops ->
    // feed share feed -> safety (2 imports) and safety -> runs (1); each
    // tail is 2.
    const result = direction([
      [`${M}/feed/a.ts`, `${M}/safety/index.ts`],
      [`${M}/feed/a2.ts`, `${M}/safety/index.ts`],
      [`${M}/safety/b.ts`, `${M}/runs/index.ts`],
      [`${M}/runs/c.ts`, `${M}/feed/index.ts`],
      [`${M}/runs/d.ts`, `${M}/feed/index.ts`],
      [`${M}/runs/e.ts`, `${M}/ops/index.ts`],
      [`${M}/runs/f.ts`, `${M}/ops/index.ts`],
      [`${M}/ops/g.ts`, `${M}/feed/index.ts`],
      [`${M}/ops/h.ts`, `${M}/feed/index.ts`],
    ]);

    expect(result.cuts).toBe(1);
    expect(result.pairs.map(({ from, to }) => `${from} ${to}`)).toStrictEqual([
      "safety runs",
    ]);
  });

  it("counts a component and a type import like any other", () => {
    expect(
      direction([
        [`${M}/feed/components/Tab.tsx`, `${M}/safety/index.ts`],
        [`${M}/safety/c.ts`, `${M}/feed/index.ts`],
      ]).cuts,
    ).toBe(1);
  });

  it("leaves out every functions.ts, a sub-module's included", () => {
    expect(
      direction([
        [`${M}/feed/functions.ts`, `${M}/safety/index.ts`],
        [`${M}/safety/c.ts`, `${M}/feed/index.ts`],
        [`${M}/ops/desk/functions.ts`, `${M}/feed/index.ts`],
        [`${M}/feed/d.ts`, `${M}/ops/desk/functions.ts`],
      ]).cuts,
    ).toBe(0);
  });

  it("leaves out a composer and every unit inside it", () => {
    expect(
      direction([
        [`${M}/dispatch/run.ts`, `${M}/feed/index.ts`],
        [`${M}/feed/a.ts`, `${M}/dispatch/index.ts`],
        [`${M}/dispatch/jobs/job.ts`, `${M}/safety/index.ts`],
        [`${M}/safety/b.ts`, `${M}/dispatch/jobs/index.ts`],
      ]).cuts,
    ).toBe(0);
  });

  it("counts a floor unit apart from its module, and any other sub-module with it", () => {
    const viaFloor = [
      [`${M}/ops/a.ts`, `${M}/safety/index.ts`],
      [`${M}/safety/b.ts`, `${M}/ops/outbox/index.ts`],
    ] as const;
    const viaDesk = [
      [`${M}/ops/a.ts`, `${M}/safety/index.ts`],
      [`${M}/safety/b.ts`, `${M}/ops/desk/index.ts`],
    ] as const;

    expect(direction(viaFloor).cuts).toBe(0);
    expect(direction(viaFloor, { composers: [], floor: [] }).cuts).toBe(1);
    expect(direction(viaDesk).cuts).toBe(1);
  });

  it("leaves out imports inside one unit, and ends outside the modules", () => {
    expect(
      direction([
        [`${M}/feed/a.ts`, `${M}/feed/b.ts`],
        ["src/server.ts", `${M}/feed/index.ts`],
        [`${M}/feed/a.ts`, "src/lib/dates.ts"],
        [`${M}/ops/outbox/a.ts`, `${M}/ops/outbox/b.ts`],
      ]),
    ).toStrictEqual({ cuts: 0, pairs: [] });
  });

  it("refuses a listed name that is no unit", () => {
    expect(() =>
      direction([], { composers: ["gone"], floor: ["ops/old", "ops/outbox"] }),
    ).toThrow(
      new Error(
        "gone, ops/old: listed in scripts/modules/direction.ts, and no unit has that name",
      ),
    );
  });

  it("refuses a group too large to order exactly", () => {
    const names = Array.from({ length: 21 }, (_, at) => `m${String(at)}`);
    const folders = names.map((name) => `${M}/${name}`);
    const ring = names.map((name, at) => ({
      from: `${M}/${name}/a.ts`,
      to: `${M}/${names[(at + 1) % names.length] ?? ""}/index.ts`,
    }));

    expect(() =>
      directionOf(ring, folders, { composers: [], floor: [] }),
    ).toThrow(/21 units, more than the direction can order \(20\)$/u);
  });

  it("lists the composers and the floor of design 261 ruling 4", () => {
    expect(DIRECTION_LISTS).toStrictEqual({
      composers: ["account/purge", "dispatch"],
      floor: [
        "ops/gave-up",
        "ops/limits",
        "ops/outbox",
        "ops/sentry",
        "safety/rules",
      ],
    });
  });
});
