import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * Surface 2 of the Motion Doctrine's per-surface map — "Offline / error:
 * **nothing. Deliberately static.** A broken connection should not feel
 * alive. Stillness is the signal."
 *
 * It is satisfied by doing nothing, which is the problem: there is no code
 * to review and no test that fails when somebody adds a shake to a failure
 * band in eight months' time. `docs/product.md` §Forms & failure already
 * says nothing in the failure path animates; this is what makes that
 * enforceable rather than remembered.
 *
 * Checked against source text rather than by rendering, because the rule
 * is about every state of every failure surface, including the ones a test
 * would have to construct. A class name is the whole of the evidence: a
 * component that carries no motion utility cannot move.
 */

const sources = import.meta.glob<string>("../../src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The names that make something move. `transition`/`animation` catch a
 * hand-rolled one; the rest are this lane's utilities, and `animate-` is
 * Tailwind's own namespace, which is still live even though task 113
 * cleared most of the others.
 */
const MOVES = [
  "transition",
  "animation",
  "animate-",
  "breathe",
  "tab-indicator",
  "tab-label",
  "flow-step-",
  "bracket-close-",
  "verdict-lock",
  "sheet-motion",
  "collapsing-row",
  "row-press",
  "digit-in-",
  "digit-out-",
];

/**
The first move this source carries, if it carries one.
*/
function moveIn(source: string): string | undefined {
  return MOVES.find((move) => source.includes(move));
}

/**
 * Where the product tells a runner that something failed.
 *
 * `ui/form.tsx` holds three of them — the field message, the summary and
 * the failure band — and is excluded from the scan by name rather than by
 * path, because the file also holds `SubmitButton`, whose breathing
 * brackets are the *pending* state and are supposed to move.
 */
const FAILURE_SURFACES = [
  "src/ui/form.tsx",
  "src/modules/runs/components/ImportStatus.tsx",
  "src/modules/runs/components/StravaCallbackResult.tsx",
  "src/modules/notifications/components/NotificationList.tsx",
];

/**
 * The one moving thing `form.tsx` is allowed, and the reason the scan is
 * per-component rather than per-file.
 */
const PENDING = "export function SubmitButton";

/**
 * Each exported component and the source between it and the next one.
 *
 * Walked in one pass rather than collected and windowed, so nothing has to
 * hold the match list — the whole file is one string and the components
 * are simply the gaps between the declarations.
 */
function components(source: string): [string, string][] {
  const found: [string, string][] = [];
  let name: string | undefined;
  let start = 0;
  for (const match of source.matchAll(/export function (\w+)/g)) {
    if (name !== undefined) {
      found.push([name, source.slice(start, match.index)]);
    }
    name = match[1];
    start = match.index;
  }
  if (name !== undefined) found.push([name, source.slice(start)]);
  return found;
}

describe("the failure path is deliberately static", () => {
  it("found every surface it names, so nothing below is vacuous", () => {
    const paths = new Set(Object.keys(sources).map((key) => repoPath(key)));
    for (const surface of FAILURE_SURFACES) {
      expect([surface, paths.has(surface)]).toEqual([surface, true]);
    }
    const form = sources["../../src/ui/form.tsx"] ?? "";
    expect(components(form).length).toBeGreaterThan(5);
    expect(form).toContain(PENDING);
    // The scanner has to be able to see a move, or it proves nothing.
    expect(moveIn('className="breathe"')).toBe("breathe");
    expect(
      moveIn('className="rounded-card border border-hairline"'),
    ).toBeUndefined();
  });

  it("moves nothing on any surface that reports a failure", () => {
    for (const surface of FAILURE_SURFACES) {
      const source = sources[`../../${surface}`] ?? "";
      if (isInstrumented(source)) continue;
      // The pending state is the exception, and it is the doctrine's own:
      // the brackets breathe while work is in flight.
      //
      // It is `PendingLabel` that holds them now, not `SubmitButton`.
      // Design's round 13 gave the same treatment to eight controls that
      // used to dim to 40% instead, so the device was extracted — and the
      // exception has to follow the brackets rather than stay on the
      // component that used to own them, or the rule would exempt a button
      // that no longer moves and catch the one that does.
      const reporting = components(withoutComments(source)).filter(
        ([name]) => name !== "PendingLabel",
      );
      for (const [name, body] of reporting) {
        expect([surface, name, moveIn(body)]).toEqual([
          surface,
          name,
          undefined,
        ]);
      }
    }
  });

  it("keeps the breathing brackets on the pending state, where they belong", () => {
    const form = withoutComments(sources["../../src/ui/form.tsx"] ?? "");
    if (isInstrumented(form)) return;
    const pending = components(form).find(([name]) => name === "PendingLabel");
    expect(pending?.[1]).toContain('className="breathe"');
    // And `SubmitButton` no longer draws them itself — it delegates, which
    // is what keeps nine controls from growing nine sets of brackets.
    const submit = components(form).find(([name]) => name === "SubmitButton");
    expect(submit?.[1]).not.toContain('className="breathe"');
    expect(submit?.[1]).toContain("<PendingLabel");
  });
});
