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
  format's collector is told each element as it opens (its name, its
  attributes, the names above it) and as it closes (with its own text).
  No tree is built. `parseXmlDocument` and `fast-xml-parser` leave the
  import path; the package goes if nothing else uses it.
- **GPX** (`gpx.ts`): a collector keeps the track points under
  `gpx > trk > trkseg > trkpt` (latitude, longitude, time, elevation),
  one list a segment, exactly what `extractSegments` returned. The
  arithmetic after it (distance, pauses, moving time, climb) is unchanged.
- **TCX** (`tcx.ts`): a collector keeps each lap of the first activity
  (its start, its two totals, its first position, its altitudes), exactly
  what `readLap` returned. The arithmetic after it is unchanged.
- **The budgets, on the new reader**: the tag-and-attribute budget is
  counted before decoding, as now. No entity is expanded: `sax` reads no
  DTD, so a custom entity is refused where one is used. A document nested
  deeper than `MAX_XML_DEPTH` is refused. `sax`'s own buffer limit refuses
  an oversized name or attribute value.
- **What a file is read as does not change.** Where the two readers
  differ on an odd file (a repeated child, a time that is a bare number,
  a custom entity), the collector keeps today's answer unless that answer
  was a fault, and each case is a test.

## Contract touches

- Schema, bindings, queues, crons, routes, screens: **none**.
- A new dependency, `sax` 1.6.1 (BlueOak-1.0.0, no dependencies), chosen
  by the owner, 2026-11-18. Server-only: `check:bundle` holds it out of
  the client chunk. The open-source list is regenerated.
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
- While building, a harness outside the repo runs both readers over the
  same generated files and compares the drafts. It is not committed: the
  old reader leaves with this PR.

## Issues

- Refs #756 (SA-L23). security-audit re-reads the budgets and ticks it.

## Open questions

- Guess: `MAX_XML_DEPTH` is 64. A GPX point sits eight deep.
- Guess: the R2 object is still read whole into memory before the parse
  (the `RunSource` contract takes an `ArrayBuffer`). Reading it as a
  stream is a later step if it is wanted.
