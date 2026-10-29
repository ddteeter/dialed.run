/**
The URL a stubbed `fetch` was asked for, whichever form it came in.
*/
export function urlOf(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}
