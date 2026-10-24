import { describe, expect, it } from "vitest";

import {
  authorOf,
  bodyOf,
  commonBody,
  cssBanners,
  holderOf,
  holdersOf,
  licenceOf,
  projectOf,
  sameWords,
  shippedList,
  toolList,
} from "../../src/modules/account/licence-text";

/**
 * The text work behind `/open-source` (design 151), against the shapes
 * real licence files take — each fixture is one a shipped package uses,
 * and the first four are ones the lockfile-era parser got wrong.
 */
/**
JSON's null, as a manifest field can hold it.
*/
const NULL: unknown = JSON.parse("null");
/**
An address that is not https, which must never reach an href.
*/
const insecure = (rest: string) => `${"https".slice(0, 4)}://${rest}`;

const PERMISSION = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  "",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS". IN NO EVENT SHALL THE AUTHORS OR',
  "COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM.",
].join("\n");

const SEROVAL = `MIT License Copyright (c) 2025 Alexis Munsayac <alexis@example.com>\n\n${PERMISSION}`;
const JSESC = `Copyright Mathias Bynens <https://mathiasbynens.be/>\n\n${PERMISSION}`;
const CAMELIZE = `This software is released under the MIT license:\n\n${PERMISSION}`;
const COLOR_NAME = `The MIT License (MIT)\r\nCopyright (c) 2015 Dmitry Ivanov\r\n\r\n${PERMISSION}`;
const HEX_RGB = `MIT License\n\nCopyright (c) Sindre Sorhus <s@example.com> (https://sindresorhus.com)\n\n${PERMISSION}`;
const DOM_SERIALIZER = `License\n\n(The MIT License)\n\nCopyright (c) 2014 The cheeriojs contributors\n\n${PERMISSION}`;

describe("holderOf", () => {
  it.each([
    ["Copyright (c) 2015 Meta Platforms, Inc.", "2015 Meta Platforms, Inc"],
    ["Copyright © 2020 Someone", "2020 Someone"],
    ["Copyright (c) © 2020 Both Marks", "2020 Both Marks"],
    ["© 2019 Just A Mark", "2019 Just A Mark"],
    ["(c) 2018 Parenthesised", "2018 Parenthesised"],
    ["Copyright 2024 Plus Five Five, Inc", "2024 Plus Five Five, Inc"],
    [
      "  Copyright Mathias Bynens <https://mathiasbynens.be/>",
      "Mathias Bynens",
    ],
    [
      "MIT License Copyright (c) 2025 Alexis Munsayac <a@b.c>",
      "2025 Alexis Munsayac",
    ],
    ["(The MIT License) Copyright (c) 2014 TJ", "2014 TJ"],
    [
      "Copyright (c) Sindre Sorhus <s@x.y> (https://sindresorhus.com)",
      "Sindre Sorhus",
    ],
    ["COPYRIGHT (C) 2015 SHOUTING LTD;", "2015 SHOUTING LTD"],
    ["Copyright: 2001 Colon", "2001 Colon"],
    ["Copyright(c)2020 Tight", "2020 Tight"],
    ["Copyright (c)2021 Half", "2021 Half"],
    ["Copyright 2020 Spaced .", "2020 Spaced"],
    ["Copyright 2020 Name<n@x.y>", "2020 Name"],
    ["Copyright 2020 A <a@x.y> and B <b@x.y>", "2020 A and B"],
    ["Copyright 2020 Wide   Gap", "2020 Wide Gap"],
    [`Copyright 2020 Old Site (${insecure("old.example")})`, "2020 Old Site"],
    [
      "Copyright 2020 Keeps (parenthesised) words",
      "2020 Keeps (parenthesised) words",
    ],
    ["Licensed MIT, Copyright 2020 After A Title", "2020 After A Title"],
  ])("reads %j as %j", (line, holder) => {
    expect(holderOf(line)).toBe(holder);
  });

  it.each([
    "COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY",
    "The above copyright notice and this permission notice shall be included",
    "copyright notice that is included in or attached to the work",
    "Copyright and related rights are waived",
    "Copyright Owner means the individual",
    "Copyright law does not apply",
    "Copyright The Thing",
    "Copyright Holder means",
    "Copyright Notice",
    "Copyright Law applies",
    "Copyright License terms",
    "Copyright Licence terms",
    "copyright by Someone",
    "Copyright (https://example.com)",
    "Cookie-es copyright (c) Someone Else",
    "Apache License 2.0",
    "MIT License X",
    "Copyright [yyyy] [name of copyright owner]",
    "Copyright {yyyy} {name}",
    "Copyright (c) <year> <copyright holders>",
    "Copyright [year] [fullname]",
    "Copyright (c) 2020 [name of author]",
    "Copyright",
    "Copyright (c)",
    "Copyright (c) <a@b.c>",
    "(c) the Licensor may",
    "Permission is hereby granted",
    "",
  ])("finds no holder in %j", (line) => {
    expect(holderOf(line)).toBeUndefined();
  });
});

describe("holdersOf", () => {
  it("joins every holder a file names, in order", () => {
    expect(
      holdersOf(
        "Copyright (c) 2012 Roman\nCopyright (c) 2015 Douglas.\n\nThe above copyright notice applies.",
      ),
    ).toBe("2012 Roman; 2015 Douglas");
  });

  it("finds none in a file that names none", () => {
    expect(holdersOf(PERMISSION)).toBeUndefined();
  });

  it.each([
    [SEROVAL, "2025 Alexis Munsayac"],
    [JSESC, "Mathias Bynens"],
    [COLOR_NAME, "2015 Dmitry Ivanov"],
    [HEX_RGB, "Sindre Sorhus"],
  ])("reads a real file's holder", (text, holder) => {
    expect(holdersOf(text)).toBe(holder);
  });
});

describe("bodyOf", () => {
  it.each([
    ["title and copyright on one line", SEROVAL],
    ["a bare copyright", JSESC],
    ["a preamble sentence", CAMELIZE],
    ["CRLF line ends", COLOR_NAME],
    ["two title lines", DOM_SERIALIZER],
    ["a title, then the copyright", HEX_RGB],
  ])("takes out %s, leaving the licence's words", (_, text) => {
    expect(bodyOf(text)).toBe(PERMISSION);
  });

  it("keeps a long first line that only mentions a licence, colon or not", () => {
    expect(bodyOf(PERMISSION)).toBe(PERMISSION);
    const long = `${"x".repeat(45)} licence words`;
    expect(bodyOf(`${long}\nrest`)).toBe(`${long}\nrest`);
  });

  it("drops a short line naming the licence, up to 79 characters with a colon", () => {
    const preamble = `${"y".repeat(70)} licence:`;
    expect(preamble).toHaveLength(79);
    expect(bodyOf(`${preamble}\nwords`)).toBe("words");
    const longer = `${"y".repeat(71)} licence:`;
    expect(bodyOf(`${longer}\nwords`)).toBe(`${longer}\nwords`);
    const short = `${"z".repeat(30)} licence`;
    expect(short).toHaveLength(38);
    expect(bodyOf(`${short}\nwords`)).toBe("words");
    const notShort = `${"z".repeat(32)} licence`;
    expect(notShort).toHaveLength(40);
    expect(bodyOf(`${notShort}\nwords`)).toBe(`${notShort}\nwords`);
  });

  it("reads a file with CRLF line ends throughout", () => {
    const crlf = `MIT License\r\n\r\nCopyright (c) 2020 X\r\n\r\n${PERMISSION.replaceAll("\n", "\r\n")}`;
    expect(bodyOf(crlf)).toBe(PERMISSION);
  });

  it("keeps a short line that does not mention a licence", () => {
    expect(bodyOf("Short line.\nMore.")).toBe("Short line.\nMore.");
  });

  it("is nothing for a file of titles and copyrights alone", () => {
    expect(bodyOf("MIT License\n\nCopyright (c) 2020 X\n")).toBeUndefined();
  });

  it("trims what is left", () => {
    expect(bodyOf("\n  words  \n\n")).toBe("words");
  });
});

describe("sameWords", () => {
  it("compares words alone: case, spacing, punctuation and quote marks aside", () => {
    expect(sameWords("The “Software”,\n  AS-IS.")).toBe("the software as is");
    expect(sameWords('the "software" as is')).toBe("the software as is");
  });
});

describe("commonBody", () => {
  it("picks the wording most bodies share, keeping the first text that says it", () => {
    expect(commonBody(["b", "A.", "a", undefined, "a!"])).toBe("A.");
  });

  it("counts every sighting, so the majority wins even when it sorts last", () => {
    expect(commonBody(["zz", "zz", "aa"])).toBe("zz");
  });

  it("breaks a tie by the wording that sorts first", () => {
    expect(commonBody(["zeta", "alpha"])).toBe("alpha");
    expect(commonBody(["alpha", "zeta"])).toBe("alpha");
  });

  it("is nothing when no body is known", () => {
    expect(commonBody([undefined])).toBeUndefined();
    expect(commonBody([])).toBeUndefined();
  });
});

describe("authorOf", () => {
  it.each([
    ["Sindre Sorhus <s@x.y> (https://sindresorhus.com)", "Sindre Sorhus"],
    [`TJ (${insecure("tj.io")})`, "TJ"],
    ["Ana <a@x.y> (site) <b@x.y>", "Ana"],
    [{ name: "Colin McDonnell", email: "c@x.y" }, "Colin McDonnell"],
    ["  Spaced  ", "Spaced"],
  ])("reads %j as %j", (author, name) => {
    expect(authorOf(author)).toBe(name);
  });

  it.each([
    ["an address alone", "someone@example.com"],
    ["an address in brackets alone", "<someone@example.com>"],
    ["nothing", undefined],
    ["an object with no name", { email: "a@b.c" }],
    ["a name that is not text", { name: 3 }],
    ["null", NULL],
  ])("finds no name in %s", (_, author) => {
    expect(authorOf(author)).toBeUndefined();
  });

  it("keeps a name with an @ in it when it has a space too", () => {
    expect(authorOf("Team @ Acme")).toBe("Team @ Acme");
  });
});

describe("projectOf", () => {
  it("prefers an https homepage", () => {
    expect(projectOf("https://react.dev/", "facebook/react")).toBe(
      "https://react.dev/",
    );
  });

  it.each([
    ["git+https://github.com/a/b.git", "https://github.com/a/b"],
    ["git://github.com/a/b.git", "https://github.com/a/b"],
    ["ssh://git@github.com/a/b.git", "https://github.com/a/b"],
    ["owner/repo", "https://github.com/owner/repo"],
    ["github:owner/re.po", "https://github.com/owner/re.po"],
    [{ type: "git", url: "https://gitlab.com/a/b" }, "https://gitlab.com/a/b"],
  ])("reads a repository %j as %j", (repository, url) => {
    expect(projectOf(insecure("insecure.example"), repository)).toBe(url);
  });

  it.each([
    ["no repository", undefined],
    ["an http one", insecure("example.com/a")],
    ["a path deeper than owner/repo", "a/b/c"],
    ["a file path", "file:../local"],
    ["an object without a url", { type: "git" }],
    ["null", NULL],
    ["a url that is not text", { url: 4 }],
  ])("gives no link for %s", (_, repository) => {
    expect(projectOf(undefined, repository)).toBeUndefined();
  });
});

describe("projectOf's rewrites", () => {
  it("rewrites a git prefix or suffix only where it is one", () => {
    const url = "https://example.com/git+x/git://y/ssh://git@z.git/w";
    expect(projectOf(undefined, url)).toBe(url);
  });
});

describe("licenceOf", () => {
  it("reads an SPDX id as it is", () => {
    expect(licenceOf("react", "MIT")).toBe("MIT");
  });

  it("names a SEE LICENSE IN licence for its package", () => {
    expect(licenceOf("@garmin/fitsdk", "SEE LICENSE IN LICENSE.txt")).toBe(
      "@garmin/fitsdk licence",
    );
  });

  it("fails the build for a package that declares none", () => {
    expect(() => licenceOf("mystery", undefined)).toThrow(
      "mystery declares no licence",
    );
  });
});

const MIT = (name: string, text: string | undefined, version = "1.0.0") => ({
  name,
  version,
  identifier: "MIT",
  text,
});

describe("shippedList", () => {
  it("makes one row per name and version, sorted, with the holder, project and notice", () => {
    const { packages } = shippedList([
      { ...MIT("zod", JSESC), homepage: "https://zod.dev" },
      MIT("react", COLOR_NAME),
      MIT("react", COLOR_NAME),
      MIT("react", COLOR_NAME, "0.9.0"),
      {
        name: "photon",
        version: "0.4.0",
        identifier: "Apache-2.0",
        text: "Apache words",
        notice: "  This product includes…\n",
        author: "Photon Folk <p@x.y>",
      },
    ]);
    expect(packages).toStrictEqual([
      {
        name: "photon",
        version: "0.4.0",
        licence: "Apache-2.0",
        copyright: "Photon Folk",
        notice: "This product includes…",
      },
      {
        name: "react",
        version: "0.9.0",
        licence: "MIT",
        copyright: "2015 Dmitry Ivanov",
      },
      {
        name: "react",
        version: "1.0.0",
        licence: "MIT",
        copyright: "2015 Dmitry Ivanov",
      },
      {
        name: "zod",
        version: "1.0.0",
        licence: "MIT",
        copyright: "Mathias Bynens",
        project: "https://zod.dev",
      },
    ]);
  });

  it("prints each licence's common wording once, and keeps a row's own words only where they differ", () => {
    const { packages, licences } = shippedList([
      MIT("a", SEROVAL),
      MIT("b", JSESC),
      MIT("c", `Copyright 2020 C\n\n${PERMISSION}\n\nAnd one more clause.`),
      MIT("d", undefined),
    ]);
    expect(licences).toEqual({ MIT: PERMISSION });
    expect(packages.map((piece) => [piece.name, piece.text])).toEqual([
      ["a", undefined],
      ["b", undefined],
      ["c", `${PERMISSION}\n\nAnd one more clause.`],
      ["d", undefined],
    ]);
  });

  it("falls back to the author for a file that names no holder, and leaves out an empty notice", () => {
    const [row] = shippedList([
      { ...MIT("x", PERMISSION), author: { name: "X Person" }, notice: " \n" },
    ]).packages;
    expect(row).toStrictEqual({
      name: "x",
      version: "1.0.0",
      licence: "MIT",
      copyright: "X Person",
    });
  });

  it("gives a licence no text when no package of it ships one", () => {
    const { packages, licences } = shippedList([
      { name: "isbot", version: "5.0.0", identifier: "Unlicense" },
    ]);
    expect(licences).toEqual({});
    expect(packages).toStrictEqual([
      { name: "isbot", version: "5.0.0", licence: "Unlicense" },
    ]);
  });
});

describe("shippedList's choice of licences", () => {
  it("lists a choice nobody ships the text of under the first choice that has one", () => {
    const { packages, licences } = shippedList([
      { name: "a", version: "1", identifier: "MIT", text: PERMISSION },
      {
        name: "b",
        version: "1",
        identifier: "BSD-2-Clause",
        text: "BSD words",
      },
      { name: "preset", version: "1", identifier: "(Apache-2.0 OR MIT)" },
      { name: "other", version: "1", identifier: "ISC OR BSD-2-Clause" },
      { name: "lone", version: "1", identifier: "GPL OR LGPL" },
    ]);
    expect(Object.keys(licences)).toEqual(["MIT", "BSD-2-Clause"]);
    expect(packages.map((piece) => [piece.name, piece.licence])).toEqual([
      ["a", "MIT"],
      ["b", "BSD-2-Clause"],
      ["lone", "GPL OR LGPL"],
      ["other", "BSD-2-Clause"],
      ["preset", "MIT"],
    ]);
  });

  it("keeps a choice whose own text ships, under its own heading", () => {
    const { packages } = shippedList([
      { name: "a", version: "1", identifier: "MIT", text: PERMISSION },
      {
        name: "d",
        version: "1",
        identifier: "MIT OR Apache-2.0",
        text: "Dual",
      },
    ]);
    expect(packages.map((piece) => piece.licence)).toEqual([
      "MIT",
      "MIT OR Apache-2.0",
    ]);
  });
});

describe("toolList", () => {
  it("credits each tool by name, version, licence and project, sorted", () => {
    expect(
      toolList([
        {
          name: "vitest",
          version: "4.1.0",
          license: "MIT",
          homepage: "https://vitest.dev",
        },
        {
          name: "eslint",
          version: "10.0.0",
          license: { type: "MIT" },
          repository: "eslint/eslint",
        },
        { name: "tsx", version: "4.0.0", license: "MIT" },
      ]),
    ).toStrictEqual([
      {
        name: "eslint",
        version: "10.0.0",
        licence: "MIT",
        project: "https://github.com/eslint/eslint",
      },
      { name: "tsx", version: "4.0.0", licence: "MIT" },
      {
        name: "vitest",
        version: "4.1.0",
        licence: "MIT",
        project: "https://vitest.dev",
      },
    ]);
  });

  it.each([
    ["none", undefined],
    ["a type that is not text", { type: 1 }],
    ["null", NULL],
  ])("fails the build for a tool whose licence is %s", (_, license) => {
    expect(() =>
      toolList([{ name: "odd", version: "1.0.0", license }]),
    ).toThrow("odd declares no licence");
  });
});

describe("cssBanners", () => {
  it("reads each preserved banner's package and version", () => {
    expect(
      cssBanners(
        "/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */\n.a{}/*!@scope/pkg v1.0.0-rc.1+b|x*/",
      ),
    ).toEqual([
      { name: "tailwindcss", version: "4.3.3" },
      { name: "@scope/pkg", version: "1.0.0-rc.1+b" },
    ]);
    expect(cssBanners("/*! wide   v2.0.0 | MIT */")).toEqual([
      { name: "wide", version: "2.0.0" },
    ]);
  });

  it("ignores ordinary comments and banners with no version", () => {
    expect(
      cssBanners(
        "/* tailwindcss v4.3.3 | MIT */ /*! just a note */ /*! x vNext | y */",
      ),
    ).toEqual([]);
  });
});
