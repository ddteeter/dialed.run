/**
 * An id as the Desk's rows show it (R55·197, 198): its first and last four
 * characters, "01M7…BGCG", so a row's head and a photo's caption stay one
 * line. The whole id stays in reach, as a title and an accessible name,
 * wherever a short one is drawn. Anything short enough already is whole.
 */
export function shortId(id: string): string {
  return id.length <= SHORT_KEEPS + 1
    ? id
    : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/**
The characters a short id keeps: four at each end.
*/
const SHORT_KEEPS = 8;
