/**
 * The export ZIP's file format (task 126, ACC-10): how one cell is
 * written, how a `Sheet` turns into CSV text, and how the same sheet turns
 * into a README paragraph. Pure and generic over the row type, so
 * `export-sheets.ts`'s column tables and `export-files.ts`'s resolved
 * photos both build on this one `Sheet`/`Column` shape rather than two.
 */

/**
What one cell may hold before it is written.
*/
type Cell = string | number | boolean | null | undefined;

interface Column<TRow> {
  readonly name: string;
  readonly about: string;
  readonly value: (row: TRow) => Cell;
}

export interface Sheet<TRow> {
  readonly file: string;
  readonly about: string;
  readonly columns: readonly Column<TRow>[];
  readonly rows: readonly TRow[];
}

export interface ExportText {
  readonly name: string;
  readonly text: string;
}

/**
Seconds since the epoch, as the ZIP writes a moment: ISO 8601, UTC.
*/
export function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * A cell as RFC 4180 writes it: quoted when it holds a comma, a quote, a
 * line break or an edge space, with its quotes doubled. **A text cell that
 * a spreadsheet would read as a formula** (`=`, `+`, `-`, `@`, a tab or a
 * carriage return first) is prefixed with `'`: product names and captions
 * come from other people and from the web (OWASP's CSV injection advice).
 * Numbers are never prefixed — a verdict of -2 stays a number.
 */
export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value);
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/u.test(safe)
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

/**
 * The byte-order mark, first in each CSV, so a spreadsheet opens the file
 * as UTF-8 and a handle or caption with an accent reads as typed.
 */
const BOM = String.fromCodePoint(0xfe_ff);

export function csvOf<TRow>(sheet: Sheet<TRow>): ExportText {
  const lines = [
    sheet.columns.map((column) => column.name),
    ...sheet.rows.map((row) =>
      sheet.columns.map((column) => csvCell(column.value(row))),
    ),
  ];
  return {
    name: sheet.file,
    text: `${BOM}${lines.map((cells) => cells.join(",")).join("\r\n")}\r\n`,
  };
}

export function readmeSection<TRow>(sheet: Sheet<TRow>): string {
  const columns = sheet.columns.map(
    (column) => `  ${column.name}: ${column.about}`,
  );
  return [`${sheet.file}: ${sheet.about}`, ...columns].join("\n");
}

/**
Several names in one cell: a run's tags, an entry's photos.
*/
export function list(values: readonly string[]): string {
  return values.join("; ");
}
