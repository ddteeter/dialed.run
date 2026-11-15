/**
 * Who is signed in, in the words every place that says it uses: Settings'
 * sign-out row (R55·182.2) and the signed-in landing's first row (R57·271).
 * "Signed in" alone before the runner has a handle.
 */
export function signedInAs(username: string | undefined): string {
  return username === undefined ? "Signed in" : `Signed in as @${username}`;
}
