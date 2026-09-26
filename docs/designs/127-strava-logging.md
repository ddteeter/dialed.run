# Design: 127 Strava & logging

## Problem

The Strava grant lifecycle is broken end to end: a disconnect cannot revoke
(finding 0.1), a runner who revokes us on Strava is ignored (0.2, API Policy
§7.4), and the webhook accepts anyone's events (0.10). This lane makes the
lifecycle correct, then builds round 25's and round 26's logging rulings.

## Approach

**STR-1/2/5 — revoke with the refresh token, and delete the refresh path.**
Strava's `POST /oauth/revoke` takes an access **or refresh** token under
HTTP Basic client auth, and "revoking a refresh token will also revoke any
associated access tokens"; it answers 200 "whether or not the token was
found" (developers.strava.com/docs/authentication). A refresh token does not
expire until it is rotated, and nothing rotates it once the connection row
is gone. So the outbox row stores the refresh token
(`add_strava_revocation_refresh_token`, additive nullable), and the drain
revokes with it directly. That is simpler than refresh-then-revoke and
strictly better: a refresh would rotate the token only to revoke it.

That leaves **no call anywhere that needs a live access token**, since we
never read activity data. `refreshStravaToken` and D-1's "broken after 3
failures over 3 days" logic are dead code, and I delete them. Nothing else
writes `status='broken'`, so T1's Reconnect branch goes too. The columns
stay, because dropping them is destructive; they go in a later contract step
(Register). Legacy rows with no refresh token revoke with the access token.

**D-103: keep `strava_revocations` apart** (the default). Its rows hold a
credential, and `lib/outbox.ts` forbids a secret in a payload. The rewrite
did not make folding it in any cheaper. Owner question.

**STR-3.** The webhook parses `updates.authorized` (`"false"` or `false`)
for `object_type: "athlete"`. It keeps nothing else from `updates`, whose
activity fields are title, type and private. It enqueues a new
`strava_deauthorize` variant (law 9). The consumer deletes the connection by
athlete id and inserts a `strava_broken` S1 row in **one batch**, with the
event time as subject, so a redelivery is a no-op twice over. An unknown
athlete is acked. The email waits for 126's interface; the call site is
named in `consumer.ts`.

**STR-4.** `STRAVA_SUBSCRIPTION_ID` is compared before the enqueue. Unset
fails closed.

**STR-6.** A 403 from the token exchange whose `message` names the
connected-athlete limit becomes `{ ok: false, reason: "full" }`. The connect
path moves out of `functions.ts` into `oauth.ts` (`connectFromCallback`), so
glue stays glue.

**STR-7.** A new server route, `/runs/strava-connect`, sets the state cookie
and 302s to `/oauth/authorize`. T1 and O3 render a typed
`<Link reloadDocument>` to it around Strava's orange SVG
(`public/strava/`). `leaveForStrava`/`getStravaAuthorizeUrlFn` go.

**STR-8.** A1–A3 use DS2's existing grid (`desk:grid-cols-[1.55fr_1fr]`) and
put read-only cards in `data-part="rail"`. The reminder copy, T3a's
`LAST RUN SEEN` and DS2's header follow round 25. **The reminder clears on
upload by landing time, not start time.** The webhook carries no start time,
and fetching the activity would break D-33. A file run clears the oldest
unread reminder that landed within 24 h after the run ended.

**STR-9 (email) is not built here.** "At most one a day, counting both"
needs a last-emailed marker per runner, which fits in 126's
`add_notification_preferences`. Asked under Needs from other lanes.

**STR-10.** The daily digest calls `pruneStravaIds()`. It deletes
`processed_webhook_events` older than 7 days and nulls the subject of
`strava_reminder` rows older than 7 days. Strava retries a failed push "up
to a total of three attempts" within its 2 s window (docs/webhooks), so the
dedupe window needs minutes, not days.

**STR-11** retimes, fetches, and reverts the start and status unless the
attach came back `attached` or `manual`. **STR-12** adds
`add_manual_conditions_sky` (weather journal) and `sky` through weather's
manual read and write. **STR-13** gives `dayLabel` US order ("Sat Aug 29"),
plus `proseDayLabel` ("Sat, Aug 29"). **STR-14** is `lib/coords.ts`
`roundCoordinate`, two decimals (about 1 km, the weather cache key's own
precision, so the key still hits), applied where runs are stored. The
provider reads the stored point, so what we send is rounded too.

## Contract touches

- Schema: core `add_strava_revocation_refresh_token`, weather
  `add_manual_conditions_sky`. Both are additive nullable columns, listed in
  the shared packet.
- Routes: `routes/runs/strava-connect.ts` (new, server handler).
- Queue message: `strava_deauthorize` (new variant). No new binding, queue
  or cron. `STRAVA_SUBSCRIPTION_ID` is a var, typed in `env.d.ts`.
- Screens: A1, A2, A3 (desk), R2b, T1, T3, O3's slot, DS2 header, S1 rows.

## Test plan

- worker: revoke drain via the refresh token with Basic auth (fetch faked);
  legacy row; 503 retries; deauth event deletes and notifies, repeat is a
  no-op, unknown athlete acked; forged subscription enqueues nothing;
  capacity 403 answer; prune; rounded run and upstream URL; retime revert;
  sky round trip; reminder cleared by upload.
- ui: official button, `[ Connecting ]`, sheet picks and badge, time
  correction states, rail contents.
- e2e: `e2e/strava/`, `e2e/run-logging/` at 1040, conformance for the rail.

## Open questions

1. Refresh path deleted rather than wired (above). Veto if you want it kept.
2. D-103: keep apart [recommended].
3. Two-decimal coordinates [recommended].
4. Reminder clearing by landing time rather than start time (above).
