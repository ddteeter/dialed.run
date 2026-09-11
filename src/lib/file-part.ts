/**
 * The three refusals every multipart upload has to make, in one place —
 * *is this a form, is the named part a file, is it under the cap* — with
 * the sentences left to the caller.
 *
 * `feed/photos` and `runs/imports` both wrote them out. Sharing the checks
 * and not the copy is the point: the checks are the thing that must not be
 * forgotten (this is a trust boundary — the value arrives as `unknown`),
 * while the sentences are user-facing copy that the two screens word
 * differently on purpose, and CLAUDE.md keeps error copy next to the
 * schema that owns it rather than in a shared helper.
 *
 * So this answers with a *problem*, not an error: the caller maps it to its
 * own error type and its own words. That also keeps the two error classes
 * distinct, which matters because they are caught in different places.
 *
 * The size is checked against the **declared** size, before the bytes are
 * read, so an oversized upload is refused without being allocated.
 */
export type FilePartProblem = "not-form-data" | "missing" | "too-large";

/**
 * The `ok` case carries the `form` as well as the file, so a caller that
 * needs the *other* parts of the body does not have to re-narrow `unknown`
 * itself. Without it the only way back to a `FormData` is a second
 * `instanceof` whose false branch nothing can reach — a dead branch, and a
 * mutant no test could ever kill.
 */
export type FilePart =
  | Readonly<{ ok: true; file: File; form: FormData }>
  | Readonly<{ ok: false; problem: FilePartProblem }>;

export function filePartFrom(
  input: unknown,
  field: string,
  maxBytes: number,
): FilePart {
  if (!(input instanceof FormData)) {
    return { ok: false, problem: "not-form-data" };
  }
  const file = input.get(field);
  if (!(file instanceof File)) {
    return { ok: false, problem: "missing" };
  }
  if (file.size > maxBytes) {
    return { ok: false, problem: "too-large" };
  }
  return { ok: true, file, form: input };
}
