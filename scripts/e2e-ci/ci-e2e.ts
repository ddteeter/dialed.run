/**
 * What `npm run e2e:ci` runs (#877): CI's `e2e` job, read out of
 * `.github/workflows/ci.yml` rather than restated, so the local run and CI
 * cannot drift. A step CI adds is run here too, the next time anyone runs
 * `npm run e2e:ci`, without anyone editing this file.
 *
 * Only a small, known subset of YAML and of GitHub's expression language is
 * understood. Anything outside it throws with the line that caused it,
 * because a planner that guessed would be the drift this exists to prevent.
 *
 * Pure: `scripts/e2e-ci-plan.ts` reads the file and writes the plan, and
 * `scripts/e2e-ci.sh` runs it (a TypeScript file under this repo's lint
 * may not spawn a command).
 */

/**
One step of the job, as written.
*/
export interface CiStep {
  readonly name: string | undefined;
  readonly if: string | undefined;
  readonly run: string | undefined;
  readonly uses: string | undefined;
  readonly env: Readonly<Record<string, string>>;
}

/**
The `e2e` job: its legs (the matrix), its env and its steps.
*/
export interface CiJob {
  readonly legs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly steps: readonly CiStep[];
}

/**
One step of one leg, ready for the runner.
*/
export type PlannedStep =
  | { readonly kind: "skip"; readonly label: string; readonly reason: string }
  | {
      readonly kind: "run";
      readonly label: string;
      readonly env: Readonly<Record<string, string>>;
      readonly script: string;
    };

/**
The port CI's e2e runs on: `playwright.config.ts`'s default.
*/
export const CI_PORT = 3000;

/**
The job's key under `jobs:`.
*/
const JOB = "e2e";

/**
 * Steps that set up the machine rather than test the change. A worktree
 * already has them, and two would harm it: `npm ci` deletes the
 * `node_modules` another command may be using, and `--with-deps` installs
 * system packages through apt.
 */
const SETUP_RUNS: readonly {
  readonly prefix: string;
  readonly reason: string;
}[] = [
  { prefix: "npm ci", reason: "this worktree's own install" },
  {
    prefix: "npx playwright install",
    reason: "the browser is already installed",
  },
];

interface Line {
  readonly indent: number;
  readonly text: string;
  readonly number: number;
}

function significantLines(yaml: string): Line[] {
  return yaml
    .split("\n")
    .map((raw, index) => {
      const text = raw.trimStart();
      return {
        indent: raw.length - text.length,
        text: text.trimEnd(),
        number: index + 1,
      };
    })
    .filter((line) => line.text !== "" && !line.text.startsWith("#"));
}

/**
The lines strictly inside the block that `start` opens.
*/
function blockAfter(lines: readonly Line[], start: number): Line[] {
  const opener = lines[start];
  if (opener === undefined) return [];
  const block: Line[] = [];
  const rest = lines.slice(start + 1);
  for (const line of rest) {
    if (line.indent <= opener.indent) break;
    block.push(line);
  }
  return block;
}

function unquote(value: string): string {
  const quoted = /^(?<quote>["'])(?<inner>.*)\k<quote>$/u.exec(value);
  return quoted?.groups?.inner ?? value;
}

function keyValue(text: string): { key: string; value: string } | undefined {
  const match = /^(?<key>[\w-]+):(?: (?<value>.*))?$/u.exec(text);
  const key = match?.groups?.key;
  return key === undefined
    ? undefined
    : { key, value: match?.groups?.value ?? "" };
}

function fail(line: Line, why: string): never {
  throw new Error(`ci.yml line ${String(line.number)}: ${why}: ${line.text}`);
}

/**
 * A `|` block scalar, read from the raw text so its blank lines and its
 * comment lines (which are shell, not YAML, inside a script) survive.
 */
function blockScalar(rawLines: readonly string[], keyLine: Line): string {
  const body: string[] = [];
  for (const raw of rawLines.slice(keyLine.number)) {
    const text = raw.trimStart();
    if (text !== "" && raw.length - text.length <= keyLine.indent) break;
    body.push(raw);
  }
  while (body.at(-1)?.trim() === "") body.pop();
  const indents = body
    .filter((raw) => raw.trim() !== "")
    .map((raw) => raw.length - raw.trimStart().length);
  const strip = Math.min(...indents);
  return body.map((raw) => raw.slice(strip)).join("\n");
}

function mapping(block: readonly Line[]): Record<string, string> {
  const entries: Record<string, string> = {};
  const indent = block[0]?.indent;
  for (const line of block) {
    if (line.indent !== indent) continue;
    const pair = keyValue(line.text);
    if (pair === undefined) fail(line, "not a key: value pair");
    entries[pair.key] = unquote(pair.value);
  }
  return entries;
}

/**
 * One `- key: value` item of `steps:`. Its keys sit two columns right of
 * the dash, so the first line is re-read as if the dash were not there.
 */
function readStep(rawLines: readonly string[], item: readonly Line[]): CiStep {
  const [first] = item;
  if (first === undefined) throw new Error("ci.yml: an empty step");
  const keyIndent = first.indent + 2;
  const keyed = item.map((line, index) =>
    index === 0
      ? { ...line, indent: keyIndent, text: line.text.slice(2) }
      : line,
  );
  const fields: Record<string, string> = {};
  let env: Record<string, string> = {};
  for (const [index, line] of keyed.entries()) {
    if (line.indent !== keyIndent) continue;
    const pair = keyValue(line.text);
    if (pair === undefined) fail(line, "not a key: value pair");
    if (pair.key === "env") env = mapping(blockAfter(keyed, index));
    else if (pair.value === "|") fields[pair.key] = blockScalar(rawLines, line);
    else fields[pair.key] = unquote(pair.value);
  }
  return {
    name: fields.name,
    if: fields.if,
    run: fields.run,
    uses: fields.uses,
    env,
  };
}

function splitItems(steps: readonly Line[]): Line[][] {
  const indent = steps[0]?.indent;
  const items: Line[][] = [];
  for (const line of steps) {
    if (line.indent === indent && line.text.startsWith("- "))
      items.push([line]);
    else items.at(-1)?.push(line);
  }
  return items;
}

function childIndex(
  lines: readonly Line[],
  block: readonly Line[],
  key: string,
): number {
  const indent = block[0]?.indent;
  const found = block.find(
    (line) => line.indent === indent && keyValue(line.text)?.key === key,
  );
  return found === undefined ? -1 : lines.indexOf(found);
}

function listOf(value: string, line: Line): string[] {
  const match = /^\[(?<items>.*)\]$/u.exec(value);
  if (match?.groups?.items === undefined) fail(line, "expected a [flow, list]");
  return match.groups.items.split(",").map((item) => unquote(item.trim()));
}

/**
CI's `e2e` job, parsed out of the whole workflow file.
*/
export function readE2eJob(yaml: string): CiJob {
  const lines = significantLines(yaml);
  const rawLines = yaml.split("\n");
  const jobsAt = lines.findIndex(
    (line) => line.indent === 0 && line.text === "jobs:",
  );
  const jobAt = childIndex(lines, blockAfter(lines, jobsAt), JOB);
  if (jobAt === -1) throw new Error(`ci.yml has no \`${JOB}\` job under jobs:`);
  const job = blockAfter(lines, jobAt);

  const matrixAt = childIndex(
    lines,
    blockAfter(lines, childIndex(lines, job, "strategy")),
    "matrix",
  );
  const matrix = blockAfter(lines, matrixAt);
  if (matrix.length !== 1)
    throw new Error(
      "ci.yml's e2e matrix should have exactly one axis, `server`",
    );
  const [axis] = matrix as [Line];
  const pair = keyValue(axis.text);
  if (pair?.key !== "server") fail(axis, "expected the matrix axis `server`");

  const envAt = childIndex(lines, job, "env");
  const stepsAt = childIndex(lines, job, "steps");
  return {
    legs: listOf(pair.value, axis),
    env: envAt === -1 ? {} : mapping(blockAfter(lines, envAt)),
    steps: splitItems(blockAfter(lines, stepsAt)).map((item) =>
      readStep(rawLines, item),
    ),
  };
}

/**
What each expression the job uses stands for, locally.
*/
function expressionValue(expression: string, leg: string): string {
  if (expression === "matrix.server") return leg;
  // The `changes` job's verdict. e2e:ci runs on a branch about to ship,
  // where CI would compute `true` unless only prose changed.
  if (expression === "needs.changes.outputs.e2e") return "true";
  throw new Error(
    `e2e:ci does not know what \${{ ${expression} }} means locally; teach scripts/e2e-ci/ci-e2e.ts`,
  );
}

/**
Every `${{ … }}` in `text`, replaced by its local value.
*/
export function substitute(text: string, leg: string): string {
  return text.replaceAll(
    /\$\{\{([^}]*)\}\}/gu,
    (_match: string, expression: string) =>
      expressionValue(expression.trim(), leg),
  );
}

/**
`env.X == 'v'` or `matrix.X == 'v'`, the one comparison understood.
*/
const TERM = /^(env|matrix)\.(\w+) == '([^']*)'$/u;

function lookup(
  scope: string,
  name: string,
  env: Readonly<Record<string, string>>,
  leg: string,
): string | undefined {
  if (scope === "env") return env[name];
  return name === "server" ? leg : undefined;
}

/**
 * Whether a step's `if:` holds on one leg. Only conjunctions of
 * `env.X == 'v'` and `matrix.X == 'v'` are understood; anything else throws.
 */
export function isMet(
  expression: string,
  env: Readonly<Record<string, string>>,
  leg: string,
): boolean {
  return expression.split("&&").every((raw) => {
    const term = raw.trim();
    const [, scope, name, value] = TERM.exec(term) ?? [];
    if (scope === undefined || name === undefined) {
      throw new Error(
        `e2e:ci cannot evaluate the condition \`${term}\`; teach scripts/e2e-ci/ci-e2e.ts`,
      );
    }
    return lookup(scope, name, env, leg) === value;
  });
}

/**
CI's URL for the app, moved to the port this run has.
*/
export function onPort(script: string, port: number): string {
  return script
    .split(`localhost:${String(CI_PORT)}`)
    .join(`localhost:${String(port)}`);
}

function labelOf(step: CiStep): string {
  if (step.name !== undefined) return step.name;
  const lines = step.run?.split("\n").map((line) => line.trim()) ?? [];
  const [first, last] = [lines[0], lines.at(-1)];
  if (first === undefined) return step.uses ?? "(unnamed step)";
  return last === undefined || lines.length === 1
    ? first
    : `${first} … ${last}`;
}

/**
 * One leg of the job as the runner will execute it: the steps whose `if:`
 * holds on that leg, in order, each with the environment CI gives it, plus
 * `CI=true` (which GitHub sets and `e2e/support/a11y-coverage.ts` reads) and
 * the port this run chose.
 */
export function planLeg(job: CiJob, leg: string, port: number): PlannedStep[] {
  const jobEnv = Object.fromEntries(
    Object.entries(job.env).map(([key, value]) => [
      key,
      substitute(value, leg),
    ]),
  );
  return job.steps.flatMap((step): PlannedStep[] => {
    if (step.if !== undefined && !isMet(step.if, jobEnv, leg)) return [];
    const label = substitute(labelOf(step), leg);
    if (step.run === undefined) {
      return [
        { kind: "skip", label, reason: "a GitHub action, not a command" },
      ];
    }
    const setup = SETUP_RUNS.find((entry) =>
      step.run?.startsWith(entry.prefix),
    );
    if (setup !== undefined)
      return [{ kind: "skip", label, reason: setup.reason }];
    const stepEnv = Object.fromEntries(
      Object.entries(step.env).map(([key, value]) => [
        key,
        substitute(value, leg),
      ]),
    );
    return [
      {
        kind: "run",
        label,
        env: {
          ...jobEnv,
          ...stepEnv,
          CI: "true",
          DIALED_E2E_PORT: String(port),
        },
        script: onPort(substitute(step.run, leg), port),
      },
    ];
  });
}

function shellQuote(value: string): string {
  const escaped = value.replaceAll("'", String.raw`'\''`);
  return `'${escaped}'`;
}

/**
A planned run step as a script for `bash -e`, which is CI's shell.
*/
export function scriptText(
  step: Extract<PlannedStep, { kind: "run" }>,
): string {
  const exports = Object.entries(step.env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");
  return `${exports}\n${step.script}\n`;
}
