# Design: 246 import-streaming

## Problem

SA-L23, the second of two PRs (design 245 was the first). A GPX or TCX
file is parsed into a tree of the whole document before the parser reads
the few numbers it wants, so a long run recorded every second costs many
times its own size in memory, and a large file can fail to import after
the upload accepted it. This PR reads the file as a stream of events and
keeps only what the run needs, so memory stays flat as the file grows.

## Approach

All in `src/modules/runs/parsers/`.

- **An event reader**, `xml-events.ts`: decodes the bytes in chunks
  (UTF-8, fatal, as today) and feeds them to `sax` in strict mode. A
  format's collector is told each element as it opens (its attributes,
  the names from the root down to it) and says whether it wants it whole.
  A wanted element (one track point, one lap total) is built into a small
  value of the shape the parsers already read, handed over when it
  closes, and let go. No tree of the document is built.
  `parseXmlDocument` and `fast-xml-parser` leave; nothing else used the
  package.
- **GPX** (`gpx.ts`): a collector asks for each `gpx > trk > trkseg >
trkpt` and reads it with `parseTrackPoint`, unchanged, one list a
  segment. The arithmetic after it (distance, pauses, moving time, climb)
  is unchanged.
- **TCX** (`tcx.ts`): a collector keeps each lap of the first activity:
  its start, its two totals, and from each trackpoint the first position
  and the altitude, read with `positionOf`, unchanged. The arithmetic
  after it is unchanged.
- **The budgets, on the new reader**: the tag-and-attribute budget is
  counted before decoding, as now. No entity is expanded: `sax` reads no
  DTD, only XML's own five entities are read, and any other stays the
  text it was written as. A document nested deeper than `MAX_XML_DEPTH`
  is refused. A name or attribute value that outgrows `sax`'s buffer is
  refused.
- **What a file is read as does not change.** The tree parser forgave
  malformed XML (an unclosed tag, a bare `&`, text after the root), so
  `sax`'s report of one is not a refusal either: it is told to carry on,
  and the run's own checks decide. Because a wanted element is built in
  the tree's shape, a repeated child, an attribute on a leaf and a time
  that is a bare number all read as they did.
- **The reader never tells `sax` the document has ended.** It flushes the
  decoder, which is what refuses a character cut off by the end of the
  file, and stops. `sax`'s own close would add only a report of what was
  left open, and an unclosed tag is forgiven; no test and none of the 66
  documents below reads differently without it.

## Contract touches

- Schema, bindings, queues, crons, routes, screens: **none**.
- A new dependency, `sax` 1.6.1 (BlueOak-1.0.0, no dependencies), with
  its types (`@types/sax`, a dev dependency). The owner chose it over
  `saxes` 6.0.0 on 2026-11-18: `sax` is maintained (its last release was
  July 2026, `saxes`'s May 2022) and brings nothing with it, where
  `saxes` brings one package; `saxes` is the faster and the stricter of
  the two, and neither matters here. `fast-xml-parser` and the six
  packages it brought are removed. Server-only: `check:bundle` holds
  `sax` out of the client chunk. The open-source list is regenerated.
- Screens: About › Open source gains a licence group, since no shipped
  package was under Blue Oak before. The owner chose its wording on
  2026-11-19, by Round 61's rule (SPDX's names): the heading is "Projects
  under the Blue Oak Model License 1.0.0", and the short name stays the
  id, "BlueOak-1.0.0". The two transcripts that read the page are
  re-recorded; they change by that group, the seven rows that left and the
  positions after them.
- Three grants in `guardrails.config.json` are withdrawn: the Stryker
  exemptions for the tree walk's guards, which are gone.
- The caps and the upload's sentences are design 245's and do not change:
  GPX and TCX stay at 25 MB.

## Test plan

All vitest, `worker` project.

- The existing GPX and TCX suites pass unchanged: they are the pin on
  what a file is read as.
- New, `test/runs/xml-events.test.ts`: events in document order with
  their parents; text across chunk boundaries, a multi-byte character
  split between two chunks, CDATA, a byte-order mark; invalid UTF-8,
  malformed XML, a custom entity, a document over the depth budget, each
  refused with its reason.
- New cases in `gpx.test.ts` and `tcx.test.ts` for each difference between
  the readers, and a long run read in many chunks.
- While building, a harness that is not committed ran the old parsers
  and the new over the same 66 documents (the fixtures, and one for each
  oddity above and more). 64 gave the same draft or the same refusal. The
  two that differ are a `<Lap>` with nothing in it and one holding only
  text: the runner reads the same sentence, and the maintainer's reason
  is now "no readable StartTime" where it was "no Lap element".

## Issues

- Refs #756 (SA-L23). security-audit re-reads the budgets and ticks it.

## Open questions

- Guess: `MAX_XML_DEPTH` is 64. A GPX point's heart rate sits eight deep.
- Guess: the R2 object is still read whole into memory before the parse
  (the `RunSource` contract takes an `ArrayBuffer`). Reading it as a
  stream is a later step if it is wanted.
