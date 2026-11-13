import { createContext, useContext, useEffect } from "react";
import { z } from "zod";

import { rowIdSchema } from "../../../lib/ids";

/**
 * Where an operator opened a kit from (Round 51 · 153, #527): a report's
 * row in Review's queue or a removal request's. The kit's back link names
 * it and returns to that row. Carried in the kit's URL, so it is parsed:
 * anything that isn't both parts reads as no origin, and the link goes
 * back to Review.
 */
export const kitOriginSchema = z.object({
  from: z.enum(["report", "request"]).optional().catch(undefined),
  row: rowIdSchema.optional().catch(undefined),
});

export type KitOriginSearch = z.infer<typeof kitOriginSchema>;

export type KitOrigin = Readonly<{
  from: "report" | "request";
  row: string;
}>;

/**
 * The anchor a row in Review carries, which the back link returns to.
 */
export function kitOriginAnchor(origin: KitOrigin): string {
  return `${origin.from}-${origin.row}`;
}

/**
 * The row a hash names, as `kitOriginAnchor` writes it for rows `from`
 * one list: `#report-01J…` is a report row's. Anything else is no row.
 */
export function rowFromHash(
  hash: string,
  from: KitOrigin["from"],
): string | undefined {
  const prefix = `#${from}-`;
  return hash.startsWith(prefix)
    ? rowIdSchema.safeParse(hash.slice(prefix.length)).data
    : undefined;
}

/**
 * Back from a kit (round 52 #155.5): the row the back link names takes
 * focus, which also scrolls it into view, and `onRow` hears which row it
 * was (Review opens it). After mount, because the server never sees a
 * hash, so the first render is the same on both sides.
 */
export function useReturnToRow(
  from: KitOrigin["from"],
  onRow: (row: string) => void,
): void {
  useEffect(() => {
    const row = rowFromHash(globalThis.location.hash, from);
    if (row === undefined) return;
    onRow(row);
    document
      .querySelector<HTMLElement>(
        `#${CSS.escape(kitOriginAnchor({ from, row }))}`,
      )
      ?.focus();
  }, [from, onRow]);
}

/**
 * The back link's words and the anchor it returns to, from the URL's
 * search. With no origin it reads "Back to Review" and has no anchor, so
 * it goes to the top.
 */
export function kitBackLink(search: KitOriginSearch): Readonly<{
  label: string;
  hash?: string;
}> {
  const { from, row } = search;
  if (from === undefined || row === undefined) {
    return { label: "Back to Review" };
  }
  return {
    label: from === "report" ? "Back to the report" : "Back to the request",
    hash: kitOriginAnchor({ from, row }),
  };
}

/**
 * The row a kit link sits in. Review's report rows and removal requests
 * provide it, and every link into `/desk/kit/` under them (the runner's
 * other photos, the matches, "Open the kit") carries it in the URL, so
 * the kit can say where it was opened from.
 */
export const KitOriginContext = createContext<KitOrigin | undefined>(undefined);

/**
 * The search a kit link carries: the row it sits in, or none.
 */
export function useKitOriginSearch(): KitOriginSearch {
  return useContext(KitOriginContext) ?? {};
}
