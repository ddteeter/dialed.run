import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  licenceGroups,
  openSourceList,
  openSourcePage,
  toolsGroup,
  type OpenSourceList,
} from "../../src/modules/account/open-source";
import {
  COLLAPSED_ROWS,
  matchingGroups,
  pieceCount,
  readLabel,
  type LicenceGroup,
} from "../../src/modules/account/open-source-search";

/**
 * `/open-source` (plan C9; round 29 #9): the generated list, read and
 * grouped on the server, and the search the page runs over it.
 */
const db = drizzle(env.DIALED_CORE);

const LIST: OpenSourceList = {
  type: [
    {
      name: "Archivo, Archivo Black",
      licence: "OFL-1.1",
      copyright: "2020 The Archivo Project Authors",
    },
  ],
  packages: [
    { name: "isbot", version: "5.1.0", licence: "Unlicense" },
    { name: "react", version: "19.2.0", licence: "MIT" },
    { name: "jose", version: "6.0.0", licence: "MIT" },
    { name: "photon", version: "0.4.0", licence: "Apache-2.0" },
    { name: "caniuse-lite", version: "1.0.0", licence: "CC-BY-4.0" },
    { name: "argparse", version: "2.0.1", licence: "Python-2.0" },
  ],
  tools: [
    {
      name: "vitest",
      version: "4.1.0",
      licence: "MIT",
      project: "https://vitest.dev",
    },
  ],
  licences: { MIT: "Permission is hereby granted", "OFL-1.1": "SIL OFL" },
};

describe("openSourceList", () => {
  it("reads the list the build wrote", () => {
    const list = openSourceList();
    expect(list.packages.length).toBeGreaterThan(100);
    expect(list.type.map((piece) => piece.name)).toEqual([
      "Archivo, Archivo Black",
      "IBM Plex Mono",
    ]);
  });

  it("credits every direct dependency, as shipped or as built with, so a new one cannot go unlisted", () => {
    const list = openSourceList();
    const credited = new Set(
      [...list.packages, ...list.tools].map((piece) => piece.name),
    );
    const missing = [
      ...Object.keys(packageJson.dependencies),
      ...Object.keys(packageJson.devDependencies),
    ].filter((name) => !credited.has(name));
    // Run `npm run build` and commit the list.
    expect(missing).toEqual([]);
  });

  it("lists what the bundles hold as shipped, and only build tools as built with", () => {
    const list = openSourceList();
    const shipped = list.packages.map((piece) => piece.name);
    const tools = list.tools.map((piece) => piece.name);
    expect(shipped).toEqual(
      expect.arrayContaining(["react", "better-auth", "tailwindcss"]),
    );
    expect(tools).toEqual(expect.arrayContaining(["vite", "vitest"]));
    expect(tools.filter((name) => shipped.includes(name))).toEqual([]);
  });

  it("has every licence's text, so no group's 'Read the licence' is missing", () => {
    const list = openSourceList();
    const licences = new Set(
      [...list.type, ...list.packages].map((piece) => piece.licence),
    );
    for (const licence of licences) {
      expect([licence, list.licences[licence]?.length]).toEqual([
        licence,
        expect.any(Number),
      ]);
    }
  });

  it("refuses a project link that is not https, which would reach an href", () => {
    const list = JSON.stringify({
      ...LIST,
      packages: [{ name: "x", licence: "MIT", project: "javascript:alert(1)" }],
    });
    expect(() => openSourceList(list)).toThrow();
  });

  it("reads a row's notice and own text whole", () => {
    const list = openSourceList(
      JSON.stringify({
        ...LIST,
        packages: [
          {
            name: "photon",
            licence: "Apache-2.0",
            notice: "This product includes software by Silvia.",
            text: "Apache, with a clause of its own.",
          },
        ],
      }),
    );
    expect(list.packages[0]).toEqual({
      name: "photon",
      licence: "Apache-2.0",
      notice: "This product includes software by Silvia.",
      text: "Apache, with a clause of its own.",
    });
  });

  it("refuses a row with no name or no licence", () => {
    for (const piece of [
      { licence: "MIT" },
      { name: "x" },
      { name: "", licence: "MIT" },
    ]) {
      expect(() =>
        openSourceList(JSON.stringify({ ...LIST, packages: [piece] })),
      ).toThrow();
    }
  });
});

describe("licenceGroups", () => {
  it("puts the type first, then the packages' licences, largest first and by name at a tie", () => {
    const groups = licenceGroups(LIST);
    expect(groups.map((group) => [group.name, group.kind])).toEqual([
      ["SIL Open Font License 1.1", "type"],
      ["MIT", "licence"],
      ["Apache 2.0", "licence"],
      ["CC BY 4.0", "licence"],
      ["Python-2.0", "licence"],
      ["Unlicense", "licence"],
    ]);
  });

  it("gives each group an id from its name, its licence's text, and its pieces in order", () => {
    const [type, mit, apache] = licenceGroups(LIST);
    expect(type).toMatchObject({
      id: "sil-open-font-license-11",
      text: "SIL OFL",
      pieces: [{ name: "Archivo, Archivo Black" }],
    });
    expect(mit).toMatchObject({
      id: "mit",
      text: "Permission is hereby granted",
      pieces: [{ name: "react" }, { name: "jose" }],
    });
    expect(apache).toMatchObject({ id: "apache-20", text: undefined });
  });

  it("draws nothing for an empty list", () => {
    expect(
      licenceGroups({ type: [], packages: [], tools: [], licences: {} }),
    ).toEqual([]);
  });
});

describe("toolsGroup", () => {
  it("puts the tools under Tools we build with, with no licence text, each row keeping its licence", () => {
    expect(toolsGroup(LIST)).toEqual({
      id: "tools-we-build-with",
      name: "Tools we build with",
      kind: "tools",
      text: undefined,
      pieces: LIST.tools,
    });
  });
});

describe("openSourcePage", () => {
  it("gives a signed-out reader the groups, the notices and no bell", async () => {
    const page = await openSourcePage(db, undefined, {
      list: JSON.stringify(LIST),
      notices: "# Third-party notices\n\nIntro.\n\n## Weather data\n\nVC.",
    });
    expect(page.bellState).toBeUndefined();
    expect(page.tools.pieces.map((piece) => piece.name)).toEqual(["vitest"]);
    expect(page.groups.map((group) => group.name)[0]).toBe(
      "SIL Open Font License 1.1",
    );
    expect(page.notices).toMatchObject({
      title: "Third-party notices",
      contents: [{ id: "weather-data", title: "Weather data" }],
    });
  });

  it("reads the real list and notices when given none, and the bell for a signed-in reader", async () => {
    const page = await openSourcePage(db, newUlid());
    expect(page.bellState).toEqual({ unreadCount: 0, verdictsWaiting: 0 });
    expect(page.notices.title).toBe("Third-party notices");
    expect(pieceCount(page.groups)).toBe(
      openSourceList().packages.length + openSourceList().type.length,
    );
    expect(page.tools.pieces).toEqual(openSourceList().tools);
  });
});

function group(
  id: string,
  names: readonly string[],
  extra: Partial<LicenceGroup> = {},
): LicenceGroup {
  return {
    id,
    name: id.toUpperCase(),
    kind: "licence",
    text: undefined,
    pieces: names.map((name) => ({ name })),
    ...extra,
  };
}

describe("matchingGroups", () => {
  const groups = [
    group("mit", ["react", "react-dom", "zod"]),
    group("isc", ["semver", "ZodLike"]),
    group("bsd", ["diff"]),
  ];

  it("leaves every group whole for a blank search", () => {
    expect(matchingGroups(groups, "")).toBe(groups);
    expect(matchingGroups(groups, " ".repeat(3))).toBe(groups);
  });

  it("keeps the pieces whose name holds the search, any case, spaces trimmed, and drops emptied groups", () => {
    expect(
      matchingGroups(groups, "  ZOD ").map((each) => [
        each.id,
        each.pieces.map((piece) => piece.name),
      ]),
    ).toEqual([
      ["mit", ["zod"]],
      ["isc", ["ZodLike"]],
    ]);
  });

  it("keeps the rest of a group as it was", () => {
    const [mit] = matchingGroups(
      [group("mit", ["react", "zod"], { text: "T", kind: "type" })],
      "react",
    );
    expect(mit).toEqual({
      id: "mit",
      name: "MIT",
      kind: "type",
      text: "T",
      pieces: [{ name: "react" }],
    });
  });

  it("finds nothing for a name nothing has", () => {
    expect(matchingGroups(groups, "xyz")).toEqual([]);
  });
});

describe("pieceCount, readLabel and the collapse", () => {
  it("counts every piece in every group", () => {
    expect(pieceCount([group("a", ["x", "y"]), group("b", ["z"])])).toBe(3);
    expect(pieceCount([])).toBe(0);
  });

  it("names the licence to read, unless the name already says licence", () => {
    expect(readLabel(group("mit", [], { name: "MIT" }))).toBe(
      "Read the MIT licence",
    );
    expect(readLabel(group("a", [], { name: "Apache 2.0" }))).toBe(
      "Read the Apache 2.0 licence",
    );
    for (const name of [
      "SIL Open Font License 1.1",
      "Unlicense",
      "@garmin/fitsdk licence",
    ]) {
      expect(readLabel(group("x", [], { name }))).toBe("Read the licence text");
    }
  });

  it("collapses a group to its first three rows (round 29 #9)", () => {
    expect(COLLAPSED_ROWS).toBe(3);
  });
});
