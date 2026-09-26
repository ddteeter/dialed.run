import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { classifyFailure, FailureBand, FormStatus, Mono } from "../../../ui";
import type { SearchResult } from "../search";
import { Avatar } from "./Avatar";
import { FollowBand, FollowPill, useFollowToggle } from "./Follow";
import type { FollowAction } from "./Follow";

/**
 * Find a runner — round 22's item 15 ruling, until round 23 draws it.
 *
 * - **Row: avatar, display name, Follow pill inline.** No city: search is
 *   the one place a stranger sees you, so they see least.
 * - **While typing, results sit under the field and the field's trailing
 *   label breathes** — `[ Searching ]`, the brackets the waiting device.
 * - **None: "No runner called @x."** — only after a search has happened,
 *   never at rest, where it would accuse the runner of having no friends
 *   before they typed.
 * - At desk it is the 620 column (the route's `max-w-column`), not the
 *   panel.
 *
 * The search runs on input rather than on a button: a prefix match on an
 * indexed column is cheap, and a button between a runner and a friend's
 * name is a step for nothing. A slower answer to an older prefix is
 * dropped rather than shown over the newer one.
 */
export function RunnerSearch({
  search,
  follow,
  unfollow,
}: Readonly<{
  search: (input: { data: { prefix: string } }) => Promise<SearchResult[]>;
  follow: FollowAction;
  unfollow: FollowAction;
}>) {
  const [prefix, setPrefix] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState<string | undefined>();
  // The prefix of the search whose answer the screen should show.
  const latest = useRef<string>(undefined);

  async function runSearch(value: string) {
    setPrefix(value);
    const trimmed = value.trim();
    latest.current = trimmed;
    if (trimmed.length === 0) {
      setResults([]);
      setSearched(undefined);
      setPending(false);
      return;
    }
    setPending(true);
    setFailed(undefined);
    try {
      const found = await search({ data: { prefix: trimmed } });
      if (latest.current !== trimmed) return;
      setResults(found);
      setSearched(trimmed);
    } catch (error: unknown) {
      // A read that failed, not an empty answer: say so, and offer the
      // same search again rather than "No runner called".
      if (latest.current !== trimmed) return;
      setResults([]);
      setSearched(undefined);
      setFailed(classifyFailure(error).message);
    }
    setPending(false);
  }

  return (
    <div className="mx-auto flex w-full max-w-column flex-col gap-6 px-5 pt-6 wide:mx-0">
      <FormStatus>{status}</FormStatus>
      <h1 className="m-0 font-display text-title uppercase">Find a runner</h1>
      <div className="field-box flex min-h-12 items-center gap-3 rounded-field border border-hairline bg-ground px-4 py-3">
        <input
          type="search"
          aria-label="Search by name"
          placeholder="Search by name"
          value={prefix}
          onChange={(event) => {
            void runSearch(event.target.value);
          }}
          className="min-w-0 flex-1 border-none bg-transparent"
        />
        {/* The field's trailing label: the brackets breathe while a search
            is out, and there is nothing there otherwise. */}
        <span
          aria-hidden="true"
          style={{ visibility: pending ? undefined : "hidden" }}
        >
          <Mono step="xs" className="flex gap-1 text-label">
            <span className="breathe">[</span>
            Searching
            <span className="breathe">]</span>
          </Mono>
        </span>
      </div>
      {failed === undefined ? undefined : (
        <FailureBand
          kicker="Didn't load"
          message={failed}
          onRetry={() => {
            void runSearch(prefix);
          }}
        />
      )}
      {searched !== undefined && results.length === 0 ? (
        <p className="m-0 text-body text-quiet">
          No runner called @{searched}.
        </p>
      ) : undefined}
      <ul className="m-0 flex list-none flex-col p-0">
        {results.map((result) => (
          <ResultRow
            key={result.userId}
            result={result}
            follow={follow}
            unfollow={unfollow}
            onStatus={setStatus}
          />
        ))}
      </ul>
    </div>
  );
}

function ResultRow({
  result,
  follow,
  unfollow,
  onStatus,
}: Readonly<{
  result: SearchResult;
  follow: FollowAction;
  unfollow: FollowAction;
  onStatus: (status: string) => void;
}>) {
  const toggle = useFollowToggle({
    userId: result.userId,
    isFollowing: result.following,
    follow,
    unfollow,
    onStatus,
  });
  return (
    <li className="flex flex-col gap-3 border-b border-hairline py-3">
      <div className="flex items-center gap-3">
        <Avatar name={result.displayName} size="small" />
        <Link
          to="/feed/u/$userId"
          params={{ userId: result.userId }}
          className="target flex flex-1 items-center text-body font-semibold text-ink no-underline"
        >
          {result.displayName}
        </Link>
        <FollowPill toggle={toggle} />
      </div>
      {/* Under the whole row, never squeezed beside the pill (§4a). */}
      <FollowBand toggle={toggle} />
    </li>
  );
}
