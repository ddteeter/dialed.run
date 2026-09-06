import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getSession } from "../../modules/auth/functions";
import { formatTemp } from "../../modules/feed/conditions";
import {
  entryDetailQuery,
  recordVerdictPromptedAction,
  toggleUsefulAction,
  verdictPromptQuery,
} from "../../modules/feed/functions";
import { redirectTo } from "../../modules/feed/redirect";
import { Bracketed, Layout, Mono } from "../../ui";

const VERDICT_LABELS: Record<number, string> = {
  "-2": "Way cold",
  "-1": "A bit cold",
  "0": "Dialed",
  "1": "A bit warm",
  "2": "Way warm",
};

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1609.34).toFixed(1)}mi`;
}

function formatDuration(durationS: number): string {
  const minutes = Math.floor(durationS / 60);
  const seconds = durationS % 60;
  return `${String(minutes)}:${seconds.toString().padStart(2, "0")}`;
}

export const Route = createFileRoute("/feed/entry/$entryId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (session === null) redirectTo({ to: "/auth/login" });
  },
  loader: async ({ params }) => {
    const session = await getSession();
    const entry = await entryDetailQuery({ data: { entryId: params.entryId } });
    if (!entry) redirectTo({ to: "/feed" });
    const isOwner = session !== null && session.user.id === entry.userId;
    const shouldPromptVerdict =
      isOwner && entry.verdict === undefined
        ? await verdictPromptQuery({ data: { entryId: params.entryId } })
        : false;
    return { entry, shouldPromptVerdict };
  },
  component: EntryDetailPage,
});

function EntryDetailPage() {
  const { entryId } = Route.useParams();
  const { entry, shouldPromptVerdict } = Route.useLoaderData();
  const [useful, setUseful] = useState({
    count: entry.usefulCount,
    reacted: entry.viewerHasReacted,
  });
  const [pending, setPending] = useState(false);

  // "Prompt once on next open, then never again" (packet A3): the prompt
  // showing at all — not the user acting on it — spends the one-time budget.
  useEffect(() => {
    if (shouldPromptVerdict) void recordVerdictPromptedAction({ data: { entryId } });
  }, [shouldPromptVerdict, entryId]);

  async function toggleUseful() {
    setPending(true);
    try {
      const result = await toggleUsefulAction({ data: { entryId } });
      setUseful((prev) => ({
        count: result.useful ? prev.count + 1 : prev.count - 1,
        reacted: result.useful,
      }));
    } finally {
      setPending(false);
    }
  }

  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 pt-6">
        {shouldPromptVerdict ? (
          <Link
            to="/feed/verdict/$entryId"
            params={{ entryId }}
            className="flex items-center justify-between rounded-xl border border-teal bg-teal/10 px-4 py-3 text-sm font-semibold text-night no-underline"
          >
            You didn&rsquo;t log a verdict for this run. Add one?
          </Link>
        ) : undefined}

        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl uppercase leading-none">
            {entry.runTitle}
          </h1>
          {entry.verdict === undefined ? undefined : (
            <Bracketed className="text-teal">
              {VERDICT_LABELS[entry.verdict] ?? "Dialed"}
            </Bracketed>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Mono className="text-sm text-night/60">
            {formatDistance(entry.distanceM)} · {formatDuration(entry.durationS)}
          </Mono>
          {entry.conditions ? (
            <Mono className="text-sm text-teal">
              {formatTemp(entry.conditions.tempC, "f")} {entry.conditions.condition}
            </Mono>
          ) : undefined}
        </div>

        <p className="m-0 text-sm text-night/60">
          {entry.authorDisplayName ?? "A runner"}
        </p>

        {entry.photoKeys.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {entry.photoKeys.map((key) => (
              <img
                key={key}
                src={`/feed/photo/${key}`}
                alt=""
                className="aspect-square w-full rounded-lg object-cover"
              />
            ))}
          </div>
        ) : undefined}

        {entry.caption ? <p className="m-0 text-base">{entry.caption}</p> : undefined}

        {entry.items.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold uppercase">Kit</h2>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {entry.items.map((item) => (
                <li key={item.itemId} className="flex items-center justify-between text-sm">
                  <span>
                    {item.brand ? `${item.brand} ` : ""}
                    {item.name}
                  </span>
                  {item.flag ? (
                    <Bracketed className="text-xs text-night/40">
                      {item.flag.replaceAll("_", " ")}
                    </Bracketed>
                  ) : undefined}
                </li>
              ))}
            </ul>
          </div>
        ) : undefined}

        {entry.tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {entry.tags.map((tag) => (
              <Bracketed key={tag} className="text-xs text-night/40">
                {tag.replaceAll("_", " ")}
              </Bracketed>
            ))}
          </div>
        ) : undefined}

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void toggleUseful();
          }}
          className={
            useful.reacted
              ? "self-start rounded-full bg-teal px-4 py-2 text-sm font-semibold text-night disabled:opacity-40"
              : "self-start rounded-full border border-night/20 px-4 py-2 text-sm font-semibold disabled:opacity-40"
          }
        >
          Useful <Mono className="ml-1">[{String(useful.count)}]</Mono>
        </button>

        <Link to="/feed" className="text-sm font-semibold text-pink">
          Back to feed
        </Link>
      </div>
    </Layout>
  );
}
