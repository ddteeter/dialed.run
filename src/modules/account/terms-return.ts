/**
 * Where Accept returns a runner a refused save brought to the terms
 * prompt, in the runner's words (D-102; round 30 #4b): "After you accept,
 * you'll go back to Log a run. What you typed wasn't kept."
 *
 * **Only the forms are here.** The line warns that typing was lost, so it
 * is true only of a page with a form on it; a refused control or loader
 * (Useful, a feed page) lost nothing, and arriving from log-in carries no
 * `from` at all. Both get no line, as round 30 draws it.
 *
 * **Each name is the page's own heading**, the words the runner saw on
 * it: `/runs/new` and `/runs/manual` are "Log a run", and `/closet/new`
 * is "Add a garment". Round 30's board says "Add a piece", a name no page
 * in the build wears (design-deltas).
 */
const FORM_PAGES: ReadonlyMap<string, string> = new Map([
  ["/runs/new", "Log a run"],
  ["/runs/manual", "Log a run"],
  ["/closet/new", "Add a garment"],
]);

/**
 * The name of the form page `from` points at, or `undefined` for any
 * other page, or none. `from` is a path on this site with its search and
 * hash (`ui/terms-refusal`), so only the path is read.
 */
export function returnPageName(from: string | undefined): string | undefined {
  // Any origin will do: only the path is read, and `from` has none. No
  // `from` reads as the path `/undefined`, which is no form page, so it
  // needs no branch of its own.
  return FORM_PAGES.get(new URL(String(from), "https://dialed.run").pathname);
}
