import { describe, expect, it } from "vitest";

import { RunParseError } from "../../src/modules/runs/parsers/shared";
import {
  MAX_XML_DEPTH,
  MAX_XML_NODES,
  XML_CHUNK_BYTES,
  isAt,
  readXml,
} from "../../src/modules/runs/parsers/xml-events";

/**
 * The reader both XML parsers stand on (design 246): what it tells a
 * collector, the values it builds, and each way it refuses. The GPX and
 * TCX suites pin what a run file is read as; this pins the reader.
 */

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

interface Seen {
  opened: [string, Record<string, string>][];
  values: [string, unknown][];
}

/**
 * Reads `text`, asking for every element whose path (joined with `/`) is
 * in `wanted`, and records what the collector was told.
 */
function read(
  text: string | ArrayBuffer,
  wanted: readonly string[] = [],
): Seen {
  const seen: Seen = { opened: [], values: [] };
  readXml(typeof text === "string" ? bytesOf(text) : text, "xml", {
    open(path, attributes) {
      seen.opened.push([path.join("/"), { ...attributes }]);
      return wanted.includes(path.join("/"));
    },
    value(path, node) {
      seen.values.push([path.join("/"), node]);
    },
  });
  return seen;
}

/**
 * The one value a document yields for `a/b`.
 */
function valueOfB(inner: string): unknown {
  const { values } = read(`<a>${inner}</a>`, ["a/b"]);
  expect(values).toHaveLength(1);
  return values[0]?.[1];
}

function failureOf(
  text: string | ArrayBuffer,
  wanted: readonly string[] = [],
): RunParseError {
  try {
    read(text, wanted);
  } catch (error) {
    if (error instanceof RunParseError) return error;
    throw error;
  }
  throw new Error("expected the read to fail");
}

describe("readXml: what a collector is told", () => {
  it("offers each element as it opens, in document order, with its path and attributes", () => {
    const { opened } = read('<a x="1"><b/><c y="2" z="3"><d/></c><b/></a>');
    expect(opened).toStrictEqual([
      ["a", { x: "1" }],
      ["a/b", {}],
      ["a/c", { y: "2", z: "3" }],
      ["a/c/d", {}],
      ["a/b", {}],
    ]);
  });

  it("builds a wanted element whole, and offers nothing inside it", () => {
    const { opened, values } = read("<a><b><c>1</c></b><d/></a>", ["a/b"]);
    expect(opened.map(([path]) => path)).toStrictEqual(["a", "a/b", "a/d"]);
    expect(values).toStrictEqual([["a/b", { c: 1 }]]);
  });

  it("hands over every wanted element, each once it has closed", () => {
    const { values } = read("<a><b>1</b><c>x</c><b>2</b></a>", ["a/b"]);
    expect(values).toStrictEqual([
      ["a/b", 1],
      ["a/b", 2],
    ]);
  });

  it("builds nothing for a document it is asked nothing of", () => {
    expect(read("<a><b>1</b></a>").values).toStrictEqual([]);
  });
});

describe("readXml: the value an element is built into", () => {
  it("is a leaf's text, trimmed, and a number where it reads as one", () => {
    expect(valueOfB("<b> 250 </b>")).toBe(250);
    expect(valueOfB("<b>-0.5</b>")).toBe(-0.5);
    expect(valueOfB("<b> 2026-01-15T07:00:00Z\n</b>")).toBe(
      "2026-01-15T07:00:00Z",
    );
    expect(valueOfB("<b>Infinity</b>")).toBe("Infinity");
  });

  it("is an empty string for an empty leaf", () => {
    expect(valueOfB("<b/>")).toBe("");
    expect(valueOfB("<b>  </b>")).toBe("");
  });

  it("is a record of prefixed attributes, children by name, and its own text", () => {
    expect(
      valueOfB('<b lat="44.9" lon="-93"><c>1</c><d>x</d>7</b>'),
    ).toStrictEqual({
      "@_lat": "44.9",
      "@_lon": "-93",
      c: 1,
      d: "x",
      "#text": 7,
    });
    expect(valueOfB('<b unit="m"/>')).toStrictEqual({ "@_unit": "m" });
    expect(valueOfB("<b><c/></b>")).toStrictEqual({ c: "" });
  });

  it("makes a list of a repeated child, in order, and nests", () => {
    expect(
      valueOfB("<b><c>1</c><d><e>x</e></d><c>2</c><c>3</c></b>"),
    ).toStrictEqual({ c: [1, 2, 3], d: { e: "x" } });
  });

  it("joins an element's text across CDATA and children", () => {
    expect(valueOfB("<b>12<![CDATA[3]]></b>")).toBe(123);
    expect(valueOfB("<b>a<c/>b</b>")).toStrictEqual({ c: "", "#text": "ab" });
    // Only the ends are trimmed: the space inside is the text's own.
    expect(valueOfB("<b> a <c/> b </b>")).toStrictEqual({
      c: "",
      "#text": "a  b",
    });
  });

  it("reads XML's own entities, and leaves any other as it was written", () => {
    expect(valueOfB("<b>a &amp; b &lt; c</b>")).toBe("a & b < c");
    expect(valueOfB("<b>caf&eacute;</b>")).toBe("caf&eacute;");
  });

  it("keeps a name a file chooses as the record's own key", () => {
    const node = valueOfB(
      "<b><__proto__><polluted>1</polluted></__proto__></b>",
    );
    if (typeof node !== "object" || node === null) {
      throw new Error("expected a record");
    }
    expect(Object.hasOwn(node, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(node)).toBe(Object.prototype);
    expect("polluted" in {}).toBe(false);
  });
});

/**
 * The start of a document, `bytes` long and ending inside `<b>`'s text:
 * what comes next is the first thing the following chunk holds.
 */
function upTo(bytes: number, text = ""): string {
  const open = "<a><c>";
  const close = `</c><b>${text}`;
  return `${open}${"x".repeat(bytes - open.length - close.length)}${close}`;
}

describe("readXml: the bytes it is given", () => {
  it("reads a value whose text is cut by the end of a chunk", () => {
    const before = upTo(XML_CHUNK_BYTES, "1234");
    expect(new TextEncoder().encode(before)).toHaveLength(XML_CHUNK_BYTES);
    const { values } = read(`${before}5678</b></a>`, ["a/b"]);
    expect(values).toStrictEqual([["a/b", 12_345_678]]);
  });

  it("reads a character whose bytes are cut by the end of a chunk", () => {
    // "é" is two bytes, and the first is the chunk's last.
    const before = upTo(XML_CHUNK_BYTES - 1);
    expect(new TextEncoder().encode(before)).toHaveLength(XML_CHUNK_BYTES - 1);
    expect(read(`${before}é</b></a>`, ["a/b"]).values).toStrictEqual([
      ["a/b", "é"],
    ]);
  });

  it("reads a document that opens with a byte-order mark", () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("<a><b>1</b></a>"),
    ]);
    expect(read(bytes.buffer, ["a/b"]).values).toStrictEqual([["a/b", 1]]);
  });

  it("reads nothing from no bytes", () => {
    expect(read(new ArrayBuffer(0))).toStrictEqual({ opened: [], values: [] });
  });

  it("refuses bytes that are not UTF-8, and names the format", () => {
    const failure = failureOf(
      new Uint8Array([0x3c, 0x61, 0x3e, 0xff, 0xfe]).buffer,
    );
    expect(failure.reason).toBe("xml: bytes are not valid UTF-8");
    expect(failure.cause).toBeInstanceOf(TypeError);
  });

  it("refuses a character cut off by the end of the file", () => {
    // The first byte of "é" and nothing after it.
    const failure = failureOf(new Uint8Array([0x3c, 0x61, 0x3e, 0xc3]).buffer);
    expect(failure.reason).toBe("xml: bytes are not valid UTF-8");
  });
});

describe("readXml: malformed XML is read as far as it makes sense", () => {
  it("reads past an unclosed tag, a bare ampersand and text after the root", () => {
    expect(read("<a><b>1</b>", ["a/b"]).values).toStrictEqual([["a/b", 1]]);
    expect(
      read("<a><n>Tom & Jerry</n><b>1</b></a>", ["a/b"]).values,
    ).toStrictEqual([["a/b", 1]]);
    expect(read("<a><b>1</b></a>junk", ["a/b"]).values).toStrictEqual([
      ["a/b", 1],
    ]);
  });

  it("reads nothing from text that is not XML", () => {
    expect(read("hello world")).toStrictEqual({ opened: [], values: [] });
  });
});

/**
 * A document of one element nested `depth` deep.
 */
function nested(depth: number): string {
  return `${"<a>".repeat(depth)}${"</a>".repeat(depth)}`;
}

describe("readXml: its budgets", () => {
  it("refuses more tags and attributes than the budget, before reading any", () => {
    const over = `<a>${"<b/>".repeat(MAX_XML_NODES)}</a>`;
    expect(failureOf(over).reason).toBe(
      "xml: more than 2000000 tags and attributes",
    );
  });

  it("reads a document nested to the depth budget, and refuses one deeper", () => {
    expect(read(nested(MAX_XML_DEPTH)).opened).toHaveLength(MAX_XML_DEPTH);
    expect(failureOf(nested(MAX_XML_DEPTH + 1)).reason).toBe(
      "xml: nested deeper than 64 elements",
    );
  });

  it("counts depth inside a value being built too", () => {
    const inside = `<r>${nested(MAX_XML_DEPTH)}</r>`;
    expect(failureOf(inside, ["r/a"]).reason).toBe(
      "xml: nested deeper than 64 elements",
    );
  });

  it("refuses an attribute value that outgrows the reader's buffer", () => {
    // `sax` checks its buffers between chunks, so the value spans several.
    const failure = failureOf(`<a b="${"x".repeat(3 * XML_CHUNK_BYTES)}"/>`);
    expect(failure.reason).toBe("xml: XML parser threw");
    expect(failure.cause).toBeInstanceOf(Error);
    expect(String(failure.cause)).toContain("Max buffer length exceeded");
  });

  it("is two million nodes, sixty-four deep, in 64 kB chunks", () => {
    expect(MAX_XML_NODES).toBe(2_000_000);
    expect(MAX_XML_DEPTH).toBe(64);
    expect(XML_CHUNK_BYTES).toBe(65_536);
  });
});

describe("isAt", () => {
  it("is true only for exactly those names, root first", () => {
    expect(isAt(["a", "b"], ["a", "b"])).toBe(true);
    expect(isAt(["a"], ["a", "b"])).toBe(false);
    expect(isAt(["a", "b", "c"], ["a", "b"])).toBe(false);
    expect(isAt(["b", "a"], ["a", "b"])).toBe(false);
    expect(isAt(["a", "x"], ["a", "b"])).toBe(false);
    expect(isAt([], [])).toBe(true);
  });
});
