<!-- guardrails:skills:start -->

## Guardrails reference docs

Read the linked doc **when its trigger applies** — not up front.

- [`boundary-validation`](../docs/guardrails/boundary-validation.md) — Use when a fix touches an `as` cast on data crossing a trust boundary — parsed JSON from disk, a network response, an environment variable, or external tool output — especially when the only mechanical fix for a type error there would be adding one. Covers why no lint rule reliably gates this, the runtime-validator alternative, and what's deliberately left for the adopting repo to decide.
- [`crushing-mutants`](../docs/guardrails/crushing-mutants.md) — Use when verify reports `stryker/survived` or `stryker/no-coverage` violations, or when working through mutants from a mutation-testing run. Covers triaging the list, writing tests that actually kill mutants, recognising vacuous assertions, proving a mutant equivalent, and the approval flow for the rare exemption.

### Never satisfy a gate by weakening it

Fix the code. Never add a suppression (`eslint-disable`, `@ts-ignore`,
`@ts-expect-error`, `@ts-nocheck`, `as any`, `.skip`, `.only`,
`@SuppressWarnings`, `// Stryker disable`), never loosen or delete an
assertion, and never delete code to quiet a checker. A deterministic
diff-auditor inspects the branch diff and re-blocks on any of them.

Equally off-limits: making a check pass by switching off the check.
Never set an entry in `guardrails.config.json`'s `analyzers` block to
`off`, never remove an analyzer from `package.json` to turn its
`analyzer-missing` error into silence, and never raise a threshold.

And never skip the gate rather than satisfy it: no `git commit
--no-verify`, no `git push --no-verify`, no unsetting `core.hooksPath`.
That flag exists for the developer, not for you. If the gate is wrong,
say so and stop — a blocked commit you report is recoverable, a bypassed
one nobody knows about is not.

### Never grant yourself an exemption

`guardrails.config.json`'s `sanctionedSuppressions` is the only escape
hatch from the diff-auditor. **You do not add an entry to it.** Nothing
downstream will catch it for you — the CI sanctions check reports a new
grant and exits 0, because a human reviewing the change is the control.

Ask the developer directly, and give them what they need to decide:

- **What** the exemption covers — the exact `file|kind|text` key.
- **Why** it is unavoidable — for an equivalent mutant, the argument that
  no test can kill it; for anything else, what you tried first.
- **What it costs** — what stops being checked once it is granted.

If they approve, put the argument they accepted into `reason`: that text is
what a reviewer reads later. If they do not, fix the code instead.

<!-- guardrails:skills:end -->
