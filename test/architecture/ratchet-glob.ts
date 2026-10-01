/**
 * A `stryker.conf.json` `mutate` glob as a regular expression. `**` spans
 * directories and `*` stops at one, which is the whole of the glob syntax
 * that array uses.
 *
 * Shared by the two tests that read the ratchet — `server-functions-are-glue`
 * asks whether any positive glob covers a path, `mutation-config` asks that
 * exactly one entry covers each `src/lib` file — so they cannot disagree
 * about what a glob means.
 */
export function ratchetGlob(glob: string): RegExp {
  // One pass, so `**/` is decided before `*` can claim its stars — two
  // passes would turn it into a pair of single-segment wildcards and
  // stop `src/modules/**/*.tsx` covering anything nested.
  const pattern = glob.replaceAll(/\*\*\/|\*|[.+?^${}()|[\]\\]/gu, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(`^${pattern}$`, "u");
}
