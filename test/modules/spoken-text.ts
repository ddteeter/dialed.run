/**
 * What an element draws and what it says, apart. `ui/Spoken` puts both
 * halves of a measure in the DOM (the drawn one `aria-hidden`, the said
 * one `sr-only`), so `textContent` reads them run together: "40–58°40 to
 * 58 degrees". These read one half each (round 53 · 162.3).
 */
function textWithout(
  element: Element | null | undefined,
  selector: string,
): string {
  if (element === null || element === undefined)
    throw new Error("no element to read");
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) throw new TypeError("not an element");
  for (const hidden of copy.querySelectorAll(selector)) hidden.remove();
  return copy.textContent;
}

/**
The text an element draws: its `sr-only` text left out.
*/
export function drawnText(element: Element | null | undefined): string {
  return textWithout(element, ".sr-only");
}

/**
The text an element says: its `aria-hidden` text left out.
*/
export function saidText(element: Element | null | undefined): string {
  return textWithout(element, "[aria-hidden='true']");
}
