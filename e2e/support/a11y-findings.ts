import { existsSync, readFileSync } from "node:fs";

import axe from "axe-core";
import { z } from "zod";

import type { PageFinding } from "./a11y-page";

/**
 * The node half of the a11y fixture (plan 161): which rules run, how a
 * finding is named, and the baseline of findings that predate it.
 */

const WCAG_TAG = /^wcag\d+a{1,2}$/u;

/**
 * Every axe rule tagged WCAG A or AA, read from axe itself rather than
 * listed, plus `region`, which axe files under best practice.
 */
export const RULES: readonly string[] = [
  ...axe
    .getRules()
    .filter((rule) => rule.tags.some((tag) => WCAG_TAG.test(tag)))
    .map((rule) => rule.ruleId),
  "region",
];

const ULID = /[0-9A-HJKMNP-TV-Z]{26}/gu;

/**
 * A path as a route: ids and numbers become `:id` and a profile's handle
 * `@:handle`, so a finding on one garment is the same finding on the
 * next.
 */
export function routeOf(pathname: string): string {
  return pathname
    .replaceAll(ULID, ":id")
    .split("/")
    .map((segment) => {
      if (/^\d+$/u.test(segment)) return ":id";
      // A runner's profile, `/@handle`: the e2e handles are seeded per run.
      return segment.startsWith("@") ? "@:handle" : segment;
    })
    .join("/");
}

/**
 * An element's description (`a11y-page.ts`'s `describe`) with what
 * differs between runs taken out: React's `useId` ids, ULIDs, and
 * numbers, which are counts, times and seeded handles. A time's AM or
 * PM goes too: a label that reads the clock differs by time of day.
 */
export function nodeOf(described: string): string {
  return described
    .replaceAll(/_[rR]_[\dA-Za-z]+_/gu, ":rid")
    .replaceAll(ULID, ":id")
    .replaceAll(/\d+/gu, "#")
    .replaceAll(/#:# [AP]M/gu, "#:#")
    .slice(0, 200);
}

export interface Finding {
  readonly rule: string;
  readonly route: string;
  readonly node: string;
}

export function findingOf(pathname: string, raw: PageFinding): Finding {
  return { rule: raw.rule, route: routeOf(pathname), node: nodeOf(raw.node) };
}

export function keyOf(finding: Finding): string {
  return `${finding.rule} ${finding.route} ${finding.node}`;
}

const BASELINE_PATH = new URL("../a11y-baseline.json", import.meta.url);

const baselineSchema = z.array(
  z.object({ rule: z.string(), route: z.string(), node: z.string() }),
);

/**
 * The findings that were already there when the fixture started
 * enforcing. Step 6 empties it; until then a finding in it is reported
 * and passes, and one not in it fails its test.
 */
export function loadBaseline(): ReadonlySet<string> {
  if (!existsSync(BASELINE_PATH)) return new Set();
  const parsed = baselineSchema.parse(
    JSON.parse(readFileSync(BASELINE_PATH, "utf8")),
  );
  return new Set(parsed.map((finding) => keyOf(finding)));
}
