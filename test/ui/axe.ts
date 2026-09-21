import { run, type AxeResults, type RunOptions } from "axe-core";

/**
 * `axe-core` over a rendered container, as one assertion.
 *
 * **What it is for, and what it is not.** The Accessibility Contract's X3
 * list opens with *"axe-core on every route … zero violations at AA"*, and
 * the packet is equally clear about the other half: *"an axe pass is not
 * the contract — nothing in axe knows that opacity may not encode meaning
 * or that success is silent unless the runner acted."* So this catches the
 * mechanical half — a control with no accessible name, a heading level
 * skipped, an `aria-*` attribute that is not valid on its element, a
 * `<label>` pointing at nothing — and the hand-written assertions beside
 * it catch the rest.
 *
 * **Two rules are disabled, and neither is a judgement about the rule.**
 * `color-contrast` needs a layout engine that resolves a stylesheet, and
 * happy-dom applies none: every element is transparent on transparent, so
 * the rule can only return "incomplete", which is a result no assertion
 * can be written against. Contrast is measured instead in
 * `test/ui/contrast.dom.test.tsx`, against T1's own values, which is
 * stricter than sampling whatever the component happened to render.
 * `region` wants every node inside a landmark, which is a statement about
 * a whole page and false of every component rendered on its own.
 */
const OPTIONS: RunOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  },
  rules: {
    "color-contrast": { enabled: false },
    region: { enabled: false },
  },
};

/**
 * The violations, as `{ id, nodes }` — the shape a failure message should
 * print.
 *
 * Returned rather than asserted so the caller writes
 * `expect(await violations(container)).toEqual([])`, and vitest's own diff
 * names the rule and the element. A custom matcher would have to build
 * that message itself, and `jest-axe`'s does it for jest's formatter.
 */
export async function violations(
  container: Element,
): Promise<{ id: string; nodes: string[] }[]> {
  const results: AxeResults = await run(container, OPTIONS);
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.html),
  }));
}
