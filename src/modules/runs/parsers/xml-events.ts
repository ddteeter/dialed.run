/**
 * A GPX or TCX read as a stream of events (SA-L23, design 246).
 *
 * The file is decoded a chunk at a time and handed to `sax`, and a
 * format's collector is told each element as it opens. Nothing is kept for
 * an element the collector does not ask for, so what a parse holds is what
 * the run needs, whatever the file's size. The elements a collector does
 * ask for (one track point, one lap total) are built into small values of
 * the shape the parsers have always read: a leaf is its text, a number
 * where it reads as one; anything with attributes or children is a record
 * of `@_`-prefixed attributes and children by name, a repeated child an
 * array, its own text under `#text`.
 */
import sax from "sax";

import { RunParseError } from "./shared";

/**
 * The most tags and attributes a GPX or TCX may hold (SA-M29, SA-L23): a
 * tag (`<`) and an attribute (`=`) each cost the reader an event or a
 * value. A thirty-hour run recorded every second, with elevation, time
 * and a few extensions on each point, is about 1.3 million tags and two
 * attributes a point more.
 */
export const MAX_XML_NODES = 2_000_000;

/**
 * How deep a document's elements may nest. A GPX point's heart rate sits
 * eight deep; the names above an element are kept while it is open, and
 * this is what bounds them.
 */
export const MAX_XML_DEPTH = 64;

/**
 * The most elements one kept element may hold, at any depth. A track
 * point with its time, elevation and a watch's extensions holds a dozen or
 * two; past this the file is refused, so what a kept element builds stays
 * small whatever the file holds.
 */
export const MAX_KEPT_ELEMENT_CHILDREN = 256;

/**
 * The most slips a document may have that the reader forgives (a bare
 * `&`, text after the root, a close tag that matches nothing). An export
 * has none or a handful; `sax` reports some slips once a character, so
 * this is what bounds the work they cost.
 */
export const MAX_XML_FAULTS = 1000;

/**
How many bytes are decoded and parsed at a time.
*/
export const XML_CHUNK_BYTES = 64 * 1024;

const TAG_OPEN = 0x3c; // "<"
const ATTRIBUTE_MARK = 0x3d; // "="

/**
 * Whether the bytes hold more tags and attributes than the budget,
 * counted before they are decoded or parsed. Every `=` counts, so one in
 * a text value counts too: the budget errs towards refusing.
 */
function hasTooManyNodes(bytes: Uint8Array): boolean {
  let nodes = 0;
  for (const byte of bytes) {
    if (byte === TAG_OPEN || byte === ATTRIBUTE_MARK) nodes += 1;
  }
  return nodes > MAX_XML_NODES;
}

/**
 * What a format reads a document with.
 *
 * `open` is told every element that is not inside a value being built,
 * with the names from the root down to it and its attributes, and says
 * whether it wants the element whole. `value` is handed each such element
 * once it has closed. The path is the reader's own array, valid only
 * during the call.
 */
export interface XmlCollector {
  open(path: readonly string[], attributes: Readonly<AttributeMap>): boolean;
  value(path: readonly string[], node: unknown): void;
}

type AttributeMap = Record<string, string>;

/**
 * Whether a path is exactly these names, root first. A collector's
 * elements are named by where they sit, as the tree's were: a `time`
 * under a track point is one, and a `time` under `metadata` is not.
 */
export function isAt(
  path: readonly string[],
  names: readonly string[],
): boolean {
  return (
    path.length === names.length &&
    names.every((name, index) => path[index] === name)
  );
}

/**
 * An element being built into a value. Each child name holds every child
 * of that name, in order.
 */
interface Frame {
  readonly attributes: Readonly<AttributeMap>;
  readonly children: Map<string, unknown[]>;
  text: string;
}

/**
 * The value a closed element is: one child of a name is that child, and
 * several are a list. `Object.fromEntries` defines each key as the
 * record's own, so no name a file chooses can reach its prototype.
 *
 * Its text is trimmed, and a number where it reads as one. A time is
 * never a bare number, and `readDate` refuses one, which is how a point
 * whose time is `2026` stays unread.
 */
function valueOf(frame: Frame): unknown {
  const trimmed = frame.text.trim();
  const number = Number(trimmed);
  const text: string | number =
    trimmed !== "" && Number.isFinite(number) ? number : trimmed;
  const entries: [string, unknown][] = Object.entries(frame.attributes).map(
    ([name, value]) => [`@_${name}`, value],
  );
  for (const [name, values] of frame.children) {
    entries.push([name, values.length === 1 ? values[0] : values]);
  }
  if (entries.length === 0) return text;
  if (text !== "") entries.push(["#text", text]);
  return Object.fromEntries(entries);
}

/**
 * `sax`'s options. Only XML's own five entities are read; any other is
 * left as the text it was written as, and none is ever expanded, since
 * `sax` reads no DTD. Held in a constant because the package's types do
 * not list `strictEntities`.
 */
const SAX_OPTIONS = { trim: false, strictEntities: true };

/**
 * The fault `sax` raises that is a refusal, not a forgivable slip.
 */
const BUFFER_OVERRUN = "Max buffer length exceeded";

/**
 * What the reader keeps while it builds the elements a collector asked
 * for: the frames open now, and how many elements the outermost of them
 * holds so far.
 */
interface Building {
  readonly frames: Frame[];
  held: number;
}

/**
 * Opens a frame for an element inside a kept one, or for a kept one
 * itself. A kept element holding more than `MAX_KEPT_ELEMENT_CHILDREN`
 * elements is refused.
 */
function openFrame(
  building: Building,
  attributes: Readonly<AttributeMap>,
  kind: string,
): void {
  if (building.frames.length === 0) building.held = 0;
  else building.held += 1;
  if (building.held > MAX_KEPT_ELEMENT_CHILDREN) {
    throw new RunParseError(
      `${kind}: an element holds more than ${String(MAX_KEPT_ELEMENT_CHILDREN)} elements`,
    );
  }
  building.frames.push({ attributes, children: new Map(), text: "" });
}

/**
 * Closes the innermost frame: the outermost goes to the collector, any
 * other is added to its parent's children of that name.
 */
function closeFrame(
  building: Building,
  name: string,
  path: readonly string[],
  collector: XmlCollector,
): void {
  const frame = building.frames.pop();
  if (frame === undefined) return;
  const parent = building.frames.at(-1);
  if (parent === undefined) {
    collector.value(path, valueOf(frame));
    return;
  }
  const siblings = parent.children.get(name);
  if (siblings === undefined) parent.children.set(name, [valueOf(frame)]);
  else siblings.push(valueOf(frame));
}

/**
 * The parser, wired to the collector. Elements outside a value being
 * built are offered to the collector; inside one, they are built into it.
 *
 * A DOCTYPE is refused: no GPX or TCX carries one, and `sax` stops
 * checking its buffers once it has read one. Every other slip is forgiven
 * up to `MAX_XML_FAULTS`.
 */
function parserFor(kind: string, collector: XmlCollector): sax.SAXParser {
  const parser = sax.parser(true, SAX_OPTIONS);
  const path: string[] = [];
  const building: Building = { frames: [], held: 0 };
  let faults = 0;

  parser.onerror = (error) => {
    if (error.message.startsWith(BUFFER_OVERRUN)) {
      throw new RunParseError(`${kind}: XML parser threw`, { cause: error });
    }
    faults += 1;
    if (faults > MAX_XML_FAULTS) {
      throw new RunParseError(
        `${kind}: more than ${String(MAX_XML_FAULTS)} XML faults`,
        { cause: error },
      );
    }
    parser.resume();
  };
  parser.ondoctype = () => {
    throw new RunParseError(`${kind}: a DOCTYPE`);
  };
  parser.onopentag = (tag: sax.Tag) => {
    path.push(tag.name);
    if (path.length > MAX_XML_DEPTH) {
      throw new RunParseError(
        `${kind}: nested deeper than ${String(MAX_XML_DEPTH)} elements`,
      );
    }
    if (
      building.frames.length > 0 ||
      collector.open(path, tag.attributes)
    ) {
      openFrame(building, tag.attributes, kind);
    }
  };
  const onText = (text: string): void => {
    const frame = building.frames.at(-1);
    if (frame !== undefined) frame.text += text;
  };
  parser.ontext = onText;
  parser.oncdata = onText;
  parser.onclosetag = (name) => {
    closeFrame(building, name, path, collector);
    path.pop();
  };
  return parser;
}

/**
 * One chunk of the bytes as text. A sequence cut by the end of a chunk is
 * held for the next (`stream`); bytes that are not UTF-8 are refused.
 */
function decoded(
  decoder: TextDecoder,
  chunk: Uint8Array | undefined,
  kind: string,
): string {
  try {
    return chunk === undefined
      ? decoder.decode()
      : decoder.decode(chunk, { stream: true });
  } catch (error) {
    throw new RunParseError(`${kind}: bytes are not valid UTF-8`, {
      cause: error,
    });
  }
}

/**
 * Reads a document, telling `collector` what it holds. Throws a
 * `RunParseError` for bytes that are not UTF-8, a document over a budget,
 * a DOCTYPE, or a name or attribute value that outgrows `sax`'s buffer
 * (64 kB, checked between chunks, so one spanning several chunks is
 * refused).
 *
 * Malformed XML is not by itself a refusal, as it was not for the tree
 * parser this replaces: an unclosed tag, a bare `&`, text after the root.
 * `sax` reports each and is told to carry on, up to `MAX_XML_FAULTS` of
 * them, so the file is read as far
 * as it makes sense and the run's own checks decide. `kind` names the
 * format in the maintainer-facing reason.
 */
export function readXml(
  bytes: ArrayBuffer,
  kind: string,
  collector: XmlCollector,
): void {
  const view = new Uint8Array(bytes);
  if (hasTooManyNodes(view)) {
    throw new RunParseError(
      `${kind}: more than ${String(MAX_XML_NODES)} tags and attributes`,
    );
  }
  const parser = parserFor(kind, collector);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = Array.from(
    { length: Math.ceil(view.length / XML_CHUNK_BYTES) },
    (_, index) =>
      view.subarray(index * XML_CHUNK_BYTES, (index + 1) * XML_CHUNK_BYTES),
  );
  for (const chunk of chunks) {
    parser.write(decoded(decoder, chunk, kind));
  }
  // The decoder's own end: a character cut off by the end of the file is
  // refused here. The parser is not told the document ended, because all
  // that would add is a report of what was left open, which is forgiven.
  parser.write(decoded(decoder, undefined, kind));
}
