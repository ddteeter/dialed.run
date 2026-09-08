import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { getSession } from "../../modules/auth/functions";
import { searchQuery } from "../../modules/feed/functions";
import { redirectTo } from "../../modules/feed/redirect";
import type { SearchResult } from "../../modules/feed/search";
import { Layout } from "../../ui";

export const Route = createFileRoute("/feed/search")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  component: SearchPage,
});

function SearchPage() {
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
    const found = await searchQuery({ data: { prefix: trimmed } });
    setResults(found);
    setSearched(true);
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        <h1 className="font-display text-2xl uppercase leading-none">Find runners</h1>
        <input
          type="search"
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
    </Layout>
  );
}
