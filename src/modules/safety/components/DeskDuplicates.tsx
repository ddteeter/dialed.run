import type { JSX } from "react";

import { Bracketed, Mono } from "../../../ui";
import type { DuplicateVariant } from "../duplicates";
import type { DuplicateGroup, DuplicatesReport } from "../duplicates-report";
import { counted } from "./counted";

/**
 * The Desk's D2 · Duplicates (task 110, Operator Screens D2): one probable
 * product with several names per card, read as a heading and its variants
 * rather than rows and columns. Brand, then the probable name in bold,
 * then how many pieces sit under each other spelling.
 *
 * Read-only on purpose (D-30): there is no merge tool in v1, and nothing
 * here links anywhere. Product and brand names are runner-typed, so they
 * are only ever React text.
 */
export function DeskDuplicates({
  report,
}: Readonly<{ report: DuplicatesReport }>): JSX.Element {
  // `min(300px, 100%)`: the board's 300px card, but never wider than a
  // 320px viewport's column, which reflow would scroll sideways.
  return (
    <section aria-labelledby="desk-duplicates" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1
          id="desk-duplicates"
          className="m-0 font-display text-title uppercase"
        >
          Duplicates
        </h1>
        <HeaderCount report={report} />
      </div>
      <p className="m-0 max-w-column text-small text-muted">
        Nothing here does anything. This is how much dirt has built up, so
        &ldquo;some dirt is accepted&rdquo; stays a decision instead of a hope.
        Sorted by pieces affected.
      </p>
      {report.cutAt === undefined ? undefined : (
        <p className="m-0 max-w-column text-small text-muted">
          {`Read the first ${String(report.cutAt)} products only. Near-misses past them aren't shown.`}
        </p>
      )}
      {report.groups.length === 0 ? (
        <p className="m-0 max-w-column text-body text-muted">
          {report.cutAt === undefined
            ? "No near-misses. Every product name under each brand is distinct."
            : `No near-misses in the first ${String(report.cutAt)} products.`}
        </p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3 p-0">
          {report.groups.map((group) => (
            <GroupCard key={group.key} group={group} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * `[61 NAMES → 23 PROBABLE PRODUCTS · 57 PIECES AFFECTED]`. The arrow is
 * hidden from screen readers and spoken as "become" (Round 46, 110d); its
 * visible space rides inside the hidden glyph, so no text node is spaces
 * alone. At zero there is nothing to become anything, so a middle dot
 * takes the arrow's place (Round 46, 110a).
 */
function HeaderCount({ report }: Readonly<{ report: DuplicatesReport }>) {
  const names = `${counted(report.names, "name")} `;
  const rest = `${counted(report.groups.length, "probable product")} · ${counted(report.pieces, "piece")} affected`;
  return (
    <Bracketed step="xs" className="text-muted">
      {report.groups.length === 0 ? (
        `${names}· ${rest}`
      ) : (
        <>
          {names}
          <span aria-hidden="true">→ </span>
          <span className="sr-only">become </span>
          {rest}
        </>
      )}
    </Bracketed>
  );
}

function GroupCard({ group }: Readonly<{ group: DuplicateGroup }>) {
  return (
    <li className="flex flex-col gap-3 border border-hairline bg-panel p-4">
      <h2 className="m-0 flex items-baseline justify-between gap-3">
        <Mono step="xs" className="min-w-0 text-muted wrap-anywhere">
          {group.brand}
        </Mono>
        <Bracketed step="xs" className="text-hiviz-text">
          {counted(group.pieces, "piece")}
        </Bracketed>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {group.products.map((variant, index) => (
          <VariantRow
            key={variant.id}
            variant={variant}
            isProbable={index === 0}
          />
        ))}
      </ul>
    </li>
  );
}

function VariantRow({
  variant,
  isProbable,
}: Readonly<{ variant: DuplicateVariant; isProbable: boolean }>) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      {isProbable ? (
        <strong className="min-w-0 text-body font-bold wrap-anywhere">
          {variant.name}
        </strong>
      ) : (
        <span className="min-w-0 text-small wrap-anywhere">{variant.name}</span>
      )}
      <Mono step="xs" className="text-muted">
        {variant.pieces}
        <span className="sr-only">
          {variant.pieces === 1 ? " piece" : " pieces"}
        </span>
      </Mono>
    </li>
  );
}
