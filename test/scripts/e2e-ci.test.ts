import { describe, expect, it } from "vitest";

import {
  CI_PORT,
  isMet,
  onPort,
  planLeg,
  readE2eJob,
  scriptText,
  substitute,
  type CiJob,
  type PlannedStep,
} from "../../scripts/e2e-ci/ci-e2e";

const WORKFLOW = `name: CI
on:
  push:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint
  e2e:
    name: \${{ matrix.server }}
    needs: changes
    strategy:
      fail-fast: false
      matrix:
        server: [dev, "preview"]
    env:
      RUN: \${{ needs.changes.outputs.e2e }}
    steps:
      # a comment between steps
      - uses: actions/checkout@v7.0.1
        with:
          persist-credentials: false
      - if: env.RUN == 'true'
        run: npm ci
      - if: env.RUN == 'true'
        run: npx playwright install --with-deps chromium
      - name: Write the vars
        if: env.RUN == 'true'
        run: |
          {
            echo "BETTER_AUTH_URL=http://localhost:3000"

            # a shell comment, kept
            echo "QUOTE=it's"
          } > .dev.vars
      - if: env.RUN == 'true' && matrix.server == 'preview'
        run: npm run build
      - if: env.RUN == 'true'
        run: npx playwright test
        env:
          E2E_SERVER: \${{ matrix.server }}
          RUN: overridden
  after:
    steps:
      - run: echo after
`;

const job = readE2eJob(WORKFLOW);

function runs(steps: readonly PlannedStep[]): string[] {
  return steps.filter((step) => step.kind === "run").map((step) => step.script);
}

describe("readE2eJob", () => {
  it("reads the matrix legs, unquoted, in order", () => {
    expect(job.legs).toEqual(["dev", "preview"]);
  });

  it("reads the job's env as written", () => {
    expect(job.env).toEqual({ RUN: "${{ needs.changes.outputs.e2e }}" });
  });

  it("reads only the e2e job's steps, every one, and no `with:` keys", () => {
    expect(
      job.steps.map((step) => step.uses ?? step.run?.split("\n", 1)[0]),
    ).toEqual([
      "actions/checkout@v7.0.1",
      "npm ci",
      "npx playwright install --with-deps chromium",
      "{",
      "npm run build",
      "npx playwright test",
    ]);
    expect(job.steps[0]).toEqual({
      name: undefined,
      if: undefined,
      run: undefined,
      uses: "actions/checkout@v7.0.1",
      env: {},
    });
  });

  it("keeps a block script's blank lines, comments and indentation, dedented", () => {
    expect(job.steps[3]?.run).toBe(
      [
        "{",
        '  echo "BETTER_AUTH_URL=http://localhost:3000"',
        "",
        "  # a shell comment, kept",
        `  echo "QUOTE=it's"`,
        "} > .dev.vars",
      ].join("\n"),
    );
    expect(job.steps[3]?.name).toBe("Write the vars");
  });

  it("reads a step's condition and its env", () => {
    expect(job.steps[4]?.if).toBe(
      "env.RUN == 'true' && matrix.server == 'preview'",
    );
    expect(job.steps[5]?.env).toEqual({
      E2E_SERVER: "${{ matrix.server }}",
      RUN: "overridden",
    });
  });

  it("throws when there is no e2e job", () => {
    expect(() =>
      readE2eJob("jobs:\n  test:\n    steps:\n      - run: x\n"),
    ).toThrow("ci.yml has no `e2e` job under jobs:");
  });

  it("throws on a matrix it does not understand", () => {
    const twoAxes = WORKFLOW.replace(
      'server: [dev, "preview"]',
      "server: [dev]\n        os: [a]",
    );
    expect(() => readE2eJob(twoAxes)).toThrow("exactly one axis");
    const renamed = WORKFLOW.replace("server: [dev", "mode: [dev");
    expect(() => readE2eJob(renamed)).toThrow(
      /line 15: expected the matrix axis `server`/u,
    );
    const scalar = WORKFLOW.replace('server: [dev, "preview"]', "server: dev");
    expect(() => readE2eJob(scalar)).toThrow("expected a [flow, list]");
  });

  it("throws on a step line that is not key: value", () => {
    const broken = WORKFLOW.replace(
      "      - if: env.RUN == 'true'\n        run: npm ci",
      "      - if: env.RUN == 'true'\n        npm ci",
    );
    expect(() => readE2eJob(broken)).toThrow("not a key: value pair: npm ci");
  });
});

describe("substitute", () => {
  it("replaces the leg and the changes verdict", () => {
    expect(
      substitute(
        "${{ matrix.server }}-${{needs.changes.outputs.e2e}}",
        "preview",
      ),
    ).toBe("preview-true");
  });

  it("throws on an expression it cannot evaluate locally", () => {
    expect(() => substitute("${{ github.sha }}", "dev")).toThrow(
      "does not know what ${{ github.sha }} means locally",
    );
  });

  it("leaves text without expressions alone", () => {
    expect(substitute("npm run build", "dev")).toBe("npm run build");
  });
});

describe("isMet", () => {
  it("holds when every term holds", () => {
    expect(
      isMet(
        "env.RUN == 'true' && matrix.server == 'preview'",
        { RUN: "true" },
        "preview",
      ),
    ).toBe(true);
  });

  it("fails when any term fails", () => {
    expect(
      isMet(
        "env.RUN == 'true' && matrix.server == 'preview'",
        { RUN: "true" },
        "dev",
      ),
    ).toBe(false);
    expect(isMet("env.RUN == 'true'", { RUN: "false" }, "dev")).toBe(false);
    expect(isMet("env.RUN == 'true'", {}, "dev")).toBe(false);
  });

  it("knows no matrix axis but server", () => {
    expect(isMet("matrix.os == 'dev'", {}, "dev")).toBe(false);
  });

  it("throws on a term it does not understand", () => {
    expect(() =>
      isMet("env.RUN == 'true' || always()", { RUN: "true" }, "dev"),
    ).toThrow("cannot evaluate the condition `env.RUN == 'true' || always()`");
  });
});

describe("onPort", () => {
  it("moves every localhost:3000 to the run's port and nothing else", () => {
    expect(CI_PORT).toBe(3000);
    expect(
      onPort(
        "http://localhost:3000 and localhost:3000/x, localhost:30001",
        4123,
      ),
    ).toBe("http://localhost:4123 and localhost:4123/x, localhost:41231");
  });
});

describe("planLeg", () => {
  const dev = planLeg(job, "dev", 4123);
  const preview = planLeg(job, "preview", 4123);

  it("skips the machine setup and the actions, saying why", () => {
    expect(dev.slice(0, 3)).toEqual([
      {
        kind: "skip",
        label: "actions/checkout@v7.0.1",
        reason: "a GitHub action, not a command",
      },
      { kind: "skip", label: "npm ci", reason: "this worktree's own install" },
      {
        kind: "skip",
        label: "npx playwright install --with-deps chromium",
        reason: "the browser is already installed",
      },
    ]);
  });

  it("runs a leg-only step on its own leg alone", () => {
    expect(runs(dev)).not.toContain("npm run build");
    expect(runs(preview)).toContain("npm run build");
    expect(runs(preview).indexOf("npm run build")).toBeLessThan(
      runs(preview).indexOf("npx playwright test"),
    );
  });

  it("gives each step CI's env, the step's over the job's, plus CI and the port", () => {
    const test = dev.at(-1);
    expect(test).toEqual({
      kind: "run",
      label: "npx playwright test",
      env: {
        RUN: "overridden",
        E2E_SERVER: "dev",
        CI: "true",
        DIALED_E2E_PORT: "4123",
      },
      script: "npx playwright test",
    });
    const vars = dev[3];
    expect(vars?.kind === "run" && vars.env).toEqual({
      RUN: "true",
      CI: "true",
      DIALED_E2E_PORT: "4123",
    });
  });

  it("moves CI's URL to the run's port", () => {
    expect(runs(dev)[0]).toContain(
      'echo "BETTER_AUTH_URL=http://localhost:4123"',
    );
    expect(runs(dev)[0]).not.toContain("localhost:3000");
  });

  it("labels a step by its name, else its command, else first … last line", () => {
    const unnamed: CiJob = {
      legs: ["dev"],
      env: {},
      steps: [
        {
          name: undefined,
          if: undefined,
          run: "{\n  echo a\n} > .dev.vars",
          uses: undefined,
          env: {},
        },
        {
          name: undefined,
          if: undefined,
          run: "echo one",
          uses: undefined,
          env: {},
        },
        {
          name: undefined,
          if: undefined,
          run: undefined,
          uses: undefined,
          env: {},
        },
      ],
    };
    expect(planLeg(unnamed, "dev", 1).map((step) => step.label)).toEqual([
      "{ … } > .dev.vars",
      "echo one",
      "(unnamed step)",
    ]);
    expect(dev[3]?.label).toBe("Write the vars");
  });

  it("drops every step whose condition fails", () => {
    expect(
      planLeg({ ...job, env: { RUN: "false" } }, "dev", 1).map(
        (step) => step.label,
      ),
    ).toEqual(["actions/checkout@v7.0.1"]);
  });
});

describe("scriptText", () => {
  it("exports each variable single-quoted, then runs the script", () => {
    expect(
      scriptText({
        kind: "run",
        label: "x",
        env: { A: "it's", B: "$HOME" },
        script: "echo hi",
      }),
    ).toBe("export A='it'\\''s'\nexport B='$HOME'\necho hi\n");
  });
});
