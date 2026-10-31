import type { MatcherFunction } from "@testing-library/react";

/**
 * Finds a value drawn in bracket notation, as `getByText(bracketed("1
 * waiting"))`.
 *
 * `Bracketed` draws its `[` and `]` in `aria-hidden` spans of their own
 * (D-150), and `getByText("[1 waiting]")` reads only an element's own text
 * nodes, so it no longer finds one. This matches the innermost element
 * whose whole text is `[1 waiting]`, which is what a sighted runner reads,
 * and works the same for brackets typed straight into a string. It matters
 * most for absence: `queryByText("[Generic]")` would pass against a screen
 * that draws `[Generic]` and prove nothing.
 */
export function bracketed(text: string): MatcherFunction {
  const drawn = `[${text}]`;
  return (_content, element) =>
    element?.textContent === drawn &&
    [...element.children].every(
      (child) => child.textContent !== drawn,
    );
}
