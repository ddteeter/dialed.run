/**
 * Runs one `run: |` step of a workflow, as text read from the file, under
 * bash with a stub `gh` on PATH. The stub answers `gh api <endpoint>` from
 * a table the test gives it, applies `--jq` with the real jq, and fails
 * like a 404 for an endpoint the table does not hold. So what the step
 * reads, and what it makes of it, is the step's own code.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const STEP_INDENT = "      - name: ";
const RUN_INDENT = 10;
const ENV_INDENT = 10;

/**
The step's lines, from its `- name:` line to the next step or job.
*/
function stepLines(workflow: string, step: string): string[] {
  const lines = workflow.split("\n");
  const start = lines.indexOf(`${STEP_INDENT}${step}`);
  if (start === -1) throw new Error(`no step named ${step}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(
    (line) => line.startsWith("      - ") || /^ {0,4}\S/u.test(line),
  );
  return end === -1 ? rest : rest.slice(0, end);
}

/**
The lines of a block scalar that starts after `index`, dedented.
*/
function blockAfter(
  lines: readonly string[],
  index: number,
  indent: number,
): string[] {
  const block: string[] = [];
  const after = lines.slice(index + 1);
  for (const line of after) {
    if (line !== "" && !line.startsWith(" ".repeat(indent))) break;
    block.push(line.slice(indent));
  }
  while (block.at(-1) === "") block.pop();
  return block;
}

/**
The step's `run: |` script.
*/
export function scriptOf(workflow: string, step: string): string {
  const lines = stepLines(workflow, step);
  const run = lines.indexOf("        run: |");
  if (run === -1) throw new Error(`step ${step} has no run block`);
  return `${blockAfter(lines, run, RUN_INDENT).join("\n")}\n`;
}

/**
The step's `env:` values that are written out in the file, not taken from
an expression. A `|` value keeps its lines; a `>-` value folds them.
*/
export function literalEnvOf(
  workflow: string,
  step: string,
): Record<string, string> {
  const lines = stepLines(workflow, step);
  const env = lines.indexOf("        env:");
  const values: Record<string, string> = {};
  if (env === -1) return values;
  const entries = lines.slice(env + 1).entries();
  for (const [offset, line] of entries) {
    if (!line.startsWith(" ".repeat(ENV_INDENT))) break;
    const entry = /^ {10}([A-Z_][A-Z\d_]*): ?(.*)$/u.exec(line);
    if (entry === null) continue;
    const [, key = "", value = ""] = entry;
    const literal = literalValue(lines, env + 1 + offset, value);
    if (literal !== undefined) values[key] = literal;
  }
  return values;
}

/**
The literal an env entry holds, or undefined when an expression supplies it.
*/
function literalValue(
  lines: readonly string[],
  index: number,
  value: string,
): string | undefined {
  if (value.includes("${{")) return undefined;
  if (value !== "|" && value !== ">-") return value;
  const block = blockAfter(lines, index, ENV_INDENT + 2);
  return value === "|" ? `${block.join("\n")}\n` : block.join(" ");
}

const STUB = `
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const dir = process.env.STUB_DIR;
if (args[0] !== "api") {
  const file = args.indexOf("--body-file");
  const body = file === -1 ? "" : " <<" + fs.readFileSync(args[file + 1], "utf8") + ">>";
  fs.appendFileSync(dir + "/calls.log", (args.join(" ") + body).replace(/\\n/g, " ") + "\\n");
  if (process.env.STUB_STDOUT !== undefined) process.stdout.write(process.env.STUB_STDOUT);
  process.exit(Number(process.env.STUB_STATUS ?? 0));
}
let jq;
let endpoint;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--jq") jq = args[++i];
  else if (args[i] === "-H") i++;
  else if (!args[i].startsWith("-")) endpoint = args[i];
}
fs.appendFileSync(dir + "/calls.log", "api " + endpoint + "\\n");
const routes = JSON.parse(fs.readFileSync(dir + "/routes.json", "utf8"));
if (!Object.hasOwn(routes, endpoint)) {
  process.stderr.write("gh: Not Found (HTTP 404)\\n");
  process.exit(1);
}
const body = routes[endpoint];
const text = typeof body === "string" ? body : JSON.stringify(body);
process.stdout.write(
  jq === undefined
    ? text
    : execFileSync("jq", ["-r", jq], { input: text, encoding: "utf8", maxBuffer: 1 << 26 }),
);
`;

export interface StepRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /**
  Every `gh` call, one per line: `api <endpoint>`, or the other calls' arguments.
  */
  readonly calls: readonly string[];
  /**
  What the step wrote to `$GITHUB_OUTPUT`.
  */
  readonly output: string;
}

/**
Runs `script` under `bash -e` with `env`, `routes` behind the stub `gh`,
and `files` written into `$RUNNER_TEMP` first.
*/
export function runStep(
  script: string,
  options: {
    readonly env: Readonly<Record<string, string>>;
    readonly routes?: Readonly<Record<string, unknown>>;
    readonly files?: Readonly<Record<string, string>>;
  },
): StepRun {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-step-"));
  try {
    const bin = path.join(directory, "bin");
    const temporary = path.join(directory, "temp");
    mkdirSync(bin);
    mkdirSync(temporary);
    writeFileSync(path.join(bin, "gh"), `#!${process.execPath}\n${STUB}`);
    chmodSync(path.join(bin, "gh"), 0o755);
    writeFileSync(
      path.join(directory, "routes.json"),
      JSON.stringify(options.routes ?? {}),
    );
    writeFileSync(path.join(directory, "calls.log"), "");
    writeFileSync(path.join(directory, "output"), "");
    const files = Object.entries(options.files ?? {});
    for (const [name, content] of files)
      writeFileSync(path.join(temporary, name), content);
    const run = spawnSync("/bin/bash", ["-e", "-c", script], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        STUB_DIR: directory,
        RUNNER_TEMP: temporary,
        GITHUB_OUTPUT: path.join(directory, "output"),
        ...options.env,
      },
    });
    return {
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      calls: readFileSync(path.join(directory, "calls.log"), "utf8")
        .split("\n")
        .filter((line) => line !== ""),
      output: readFileSync(path.join(directory, "output"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
