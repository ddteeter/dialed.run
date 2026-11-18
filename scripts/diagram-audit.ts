/**
 * The half of `npm run diagrams:audit` that is not `gh` (design 229,
 * step 5; skill `diagram-audit`):
 *
 * - `brief <flow file>` prints the deriving reader's brief;
 * - `story <flow file>` prints the story for the comparing reader;
 * - `due <file>` reads `{ prs, audits }` from the file
 *   `scripts/diagram-audit.sh` fetched them into, and prints which flows
 *   are due an audit.
 *
 * The decisions are in `scripts/diagrams/audit.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { briefText, dueFlows, dueReport, storyText } from "./diagrams/audit";
import { readAudit } from "./diagrams/model";

const pull = z.object({
  number: z.number(),
  mergedAt: z.string(),
  body: z.string(),
});
const record = z.object({ title: z.string(), createdAt: z.string() });
const fetched = z.object({ prs: z.array(pull), audits: z.array(record) });

const [mode, file] = process.argv.slice(2);
const { views, elements } = await readAudit();

if (mode === "due" && file !== undefined) {
  const read: unknown = JSON.parse(readFileSync(file, "utf8"));
  const { prs, audits } = fetched.parse(read);
  const today = new Date().toLocaleDateString("en-CA");
  console.log(dueReport(dueFlows(views, prs, audits), today));
} else if (file !== undefined && (mode === "brief" || mode === "story")) {
  const flow = path.relative(process.cwd(), path.resolve(file));
  const ofFlow = views.filter((view) => view.file === flow);
  if (ofFlow.length === 0) {
    throw new Error(
      `${flow} holds no story. Name a file in docs/diagrams/flows/.`,
    );
  }
  const others = views.filter((view) => view.file !== flow);
  console.log(
    mode === "brief" ? briefText(ofFlow, elements) : storyText(ofFlow, others),
  );
} else {
  throw new Error(
    "Usage: npm run diagrams:audit -- due | brief <flow file> | story <flow file>",
  );
}
