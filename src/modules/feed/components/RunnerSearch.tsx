import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { SearchResult } from "../search";

/**
 * Find-a-runner (screen H), driven by what is typed.
 *
 * The search runs on input rather than on a button: the query is a prefix
 * match on an indexed column, so it is cheap, and a button between a
 * runner and their friend's name is a step for nothing.
 *
 * The empty state is deliberately not the resting state — "No runners
 * found." only appears after a search has actually happened, or an empty
 * box would accuse the user of having no friends before they typed.
 */
export function RunnerSearch({
  search,
}: Readonly<{
  search: (input: { data: { prefix: string } }) => Promise<SearchResult[]>;
}>) {
  const [prefix, setPrefix] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  async function runSearch(value: string) {
    setPrefix(value);
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setSearched(false);
      return;
    }
    const found = await search({ data: { prefix: trimmed } });
    setResults(found);
    setSearched(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
      <h1 className="font-display text-2xl uppercase leading-none">
        Find runners
      </h1>
      <input
        type="search"
        aria-label="Search by name"
        placeholder="Search by name"
        value={prefix}
        onChange={(event) => {
          void runSearch(event.target.value);
        }}
        className="rounded-md border border-night/20 bg-white px-3 py-2"
      />
      {searched && results.length === 0 ? (
        <p className="text-sm text-night/60">No runners found.</p>
      ) : undefined}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {results.map((result) => (
          <li key={result.userId}>
            <Link
              to="/feed/u/$userId"
              params={{ userId: result.userId }}
              className="font-semibold text-night no-underline"
            >
              {result.displayName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
