import { describe, expect, it } from "vitest";

import { isInstrumented, repoPath, withoutComments } from "./source-text";

/**
 * **A `<form>` is wired to the form primitives.**
 *
 * `docs/product.md` §Forms & failure: four lanes shipped four answers to
 * "the save failed" before `ui/form.tsx` and `ui/use-form-submit.ts`
 * existed, and a form that hand-rolls submission is a review failure. This
 * is the mechanical half of that: a component that renders `<form` must use
 * `useFormSubmit`, or take its result as a `FormShell` from a parent that
 * does. It cannot see whether the field markup uses `FormField`/`TextField`
 * — that half stays a review question.
 *
 * `ui/form.tsx` is where the primitives' own `<form>` lives.
 */

const sources: Record<string, string> = import.meta.glob(
  ["../../src/**/*.tsx", "!../../src/**/*.test.tsx"],
  { query: "?raw", import: "default", eager: true },
);

const PRIMITIVE_HOME = "src/ui/form.tsx";
const RENDERS_FORM = /<form[\s>]/u;
const WIRED = /\b(?:useFormSubmit|FormShell)\b/u;

function isHandRolledForm(source: string): boolean {
  const code = withoutComments(source);
  return RENDERS_FORM.test(code) && !WIRED.test(code);
}

const files = Object.entries(sources)
  .map(([globPath, source]) => [repoPath(globPath), source] as const)
  .filter(
    ([path, source]) => path !== PRIMITIVE_HOME && !isInstrumented(source),
  );

describe("forms use the primitives", () => {
  it("found forms to check, so nothing below is vacuous", () => {
    expect(
      files.filter(([, source]) => RENDERS_FORM.test(withoutComments(source)))
        .length,
    ).toBeGreaterThan(10);
  });

  it("every component rendering <form> is wired through useFormSubmit", () => {
    expect(
      files
        .filter(([, source]) => isHandRolledForm(source))
        .map(([path]) => path),
      "wire the form through useFormSubmit / FormShell from ui/ (see .claude/rules/ui.md §Forms)",
    ).toEqual([]);
  });

  it("would catch a bare form, and not a comment mentioning one", () => {
    expect(isHandRolledForm("return <form onSubmit={go}>x</form>;")).toBe(true);
    expect(
      isHandRolledForm(
        "const s = useFormSubmit(o); return <form ref={s.formRef} />;",
      ),
    ).toBe(false);
    expect(
      isHandRolledForm("({ shell }: { shell: FormShell }) => <form />"),
    ).toBe(false);
    expect(isHandRolledForm("// a <form action> would be wrong\n")).toBe(false);
  });
});
