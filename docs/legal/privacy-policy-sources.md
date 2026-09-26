# Privacy policy: where each claim comes from

`privacy-policy.md` is only true while the code below stays as it is. This
file maps each claim to the code or config that makes it true, as of
`origin/main` at `f544c67` (2026-09-25). **A change to any file named here
should come with a check of the matching policy line**, and a change to the
policy should come with a check of the code.

Paths are relative to the repo root. `better-auth` paths are inside
`node_modules` at the pinned version (1.7.2).

## Account

| Claim                                                                 | Source                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email and sign-up name stored                                         | `src/db/schema-auth.ts` (`user.name`, `user.email`); `src/modules/auth/credentials.ts` (`signUp` sends name, email, password)                                                                                |
| Password stored as a scrypt hash                                      | `src/modules/auth/create-auth.ts` (`emailAndPassword: { enabled: true }`, no custom hasher); `better-auth/dist/crypto/password.mjs` (scrypt); stored in `account.password` (`schema-auth.ts`)                |
| Have I Been Pwned, first 5 chars of SHA-1 only                        | **Lands with PR #104** (`feat/124-auth-shell`). Not on `main`, and not on the branch as pushed at `a7255b2`. Re-verify against the merged code before publishing.                                            |
| Google: name, email, picture, account id; scopes openid/email/profile | `create-auth.ts` (`socialProviders: { google }`, no `scope` option); `@better-auth/core/dist/social-providers/google.mjs` (default scopes, `image: user.picture`); `account` table holds `accountId`, tokens |
| Google tokens stored                                                  | `schema-auth.ts` `account.accessToken`, `refreshToken`, `idToken`                                                                                                                                            |
| Session token, 7-day expiry, user agent, IP                           | `schema-auth.ts` `session`; `better-auth/dist/db/internal-adapter.mjs` (default `expiresIn` 7 days; `ipAddress` from `getIP`, `userAgent`); `@better-auth/core/dist/utils/ip.mjs` (`x-forwarded-for`)        |
| No email sent today                                                   | No email provider, binding or secret in `wrangler.jsonc` / `src/env/env.d.ts`; no `sendVerificationEmail` / `sendResetPassword` in `create-auth.ts`                                                          |
| Telemetry off                                                         | `create-auth.ts` `telemetry: { enabled: false }`                                                                                                                                                             |

## Profile

| Claim                                                                      | Source                                                                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Display name, city label, coordinates, thermal level, units, share default | `src/db/schema-core.ts` `userProfiles`; written by `src/modules/onboarding/profile.ts` (`saveCalibration`, `savePreferences`)              |
| Coordinates stored at full precision                                       | `src/modules/onboarding/inputs.ts` (`calibrationInput.lat/lng`, no rounding); `onboarding/geolocate.ts` (raw `coords`)                     |
| Profile coordinates stand in for a manual run with none                    | `src/modules/runs/service.ts` (falls back to `userProfiles.lat/lng` when not indoor)                                                       |
| Display name and city shown on profile; thermal level not                  | `src/modules/feed/profiles.ts` `otherProfile` returns `displayName`, `cityLabel`, public entries only; `thermalLevel` only in `ownProfile` |

Note: nothing on `main` writes `user_profiles.display_name`; check PR #104
before publishing.

## Closet

| Claim                            | Source                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Garment fields                   | `schema-core.ts` `wardrobeItems`                                                |
| Delete if unused, retire if used | `src/modules/closet/service.ts` `deleteOrRetireItem`                            |
| Photo files not deleted          | No `MEDIA.delete` anywhere in `src/`; `deleteOrRetireItem` deletes the row only |

## Runs

| Claim                                               | Source                                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual run fields                                   | `schema-core.ts` `runs`                                                                                                                               |
| GPX/FIT/TCX, 25 MB cap                              | `src/modules/runs/parsers/` (`gpx.ts`, `fit.ts`, `tcx.ts`); `src/modules/runs/upload-limits.ts` `MAX_IMPORT_BYTES`                                    |
| File stored in its own bucket                       | `src/modules/runs/imports.ts` (`imports/{userId}/{importId}.{ext}` into `IMPORTS`); `wrangler.jsonc` `r2_buckets` `IMPORTS` → `dialed-imports`        |
| Only the first GPS point kept                       | `parsers/gpx.ts` (`lat: first.lat, lng: first.lon`); `runs` has one `lat`/`lng` pair and no track column                                              |
| 30-day file deletion                                | **Config outside the repo.** `wrangler.jsonc` comment: "IMPORTS: 30-day object lifecycle rule — set in the Cloudflare dashboard". Owner must confirm. |
| Manual temperature excluded from conditions numbers | `src/db/schema-weather.ts` `manualConditions` (separate table); `src/modules/feed/conditions.ts` (`ne(source, "manual")`); `docs/decisions.md` D-24   |

## Kits

| Claim                                  | Source                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Kit fields, up to four photos          | `schema-core.ts` `outfitEntries`, `outfitEntryItems`, `entryTags`, `entryPhotos`; `src/modules/feed/photos.ts` `MAX_PHOTOS_PER_ENTRY` |
| Per-garment flags and notes owner-only | `src/modules/feed/entries.ts` `getEntryDetail` (`flag`/`note` only when `isOwner`)                                                    |

## Weather and location

| Claim                                                        | Source                                                                                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run coordinates + date sent to Visual Crossing, nothing else | `src/modules/weather/provider/visual-crossing.ts` (`timelineUrl`: `{lat},{lng}/{date}` plus API key); called from `src/modules/weather/attach.ts` with the run's raw `lat`/`lng` |
| Cache rounded to 2 dp and hour, carries a run id             | `src/modules/weather/store.ts` (`roundCoord`, `hourBucketFor`, `runId` written); `schema-weather.ts` `weatherObservations`                                                       |
| Setup place sent for climate normals                         | `src/modules/weather/normals.ts`; `visual-crossing.ts` `locationPath` (coordinates or typed label); `src/modules/onboarding/climate.ts`                                          |
| "Your conditions" location not stored or sent upstream       | `src/modules/feed/components/Feed.tsx` (browser geolocation → `conditionsFor`); `src/modules/feed/conditions.ts` `currentConditions` (read-only query of the cache)              |
| Time zone from Visual Crossing                               | `schema-weather.ts` `timeZone` (D-96); `visual-crossing.ts` (`parsed.timezone`)                                                                                                  |
| Coordinates never shown                                      | `feed/entries.ts` `EntryDetail` and `feed/profiles.ts` `OtherProfile` carry no `lat`/`lng`                                                                                       |

## Photos

| Claim                                               | Source                                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blur on by default, remembered only when off        | `src/modules/safety/blur/preference.ts` (`dialed.blurFaces` in `localStorage`)                                                                                                            |
| Detection in the browser, model from our origin     | `src/modules/safety/blur/pipeline.ts` ("Nothing here runs on the Worker"); `blur/detect.ts` (`WASM_PATH`, `MODEL_PATH` are same-origin paths)                                             |
| Pixelated, not blurred                              | `blur/paint.ts` `PIXEL_BLOCKS`                                                                                                                                                            |
| Blur on: upload is a canvas re-encode (no metadata) | `blur/paint.ts` `blurredFile` (`canvas.toBlob(…, "image/jpeg")`); `src/modules/safety/components/PhotoBlur.tsx` `publish` hands only the blurred file on                                  |
| Blur off: original uploaded                         | `PhotoBlur.tsx` (`if (!isOn) { onReady(file) }`)                                                                                                                                          |
| No server-side metadata stripping                   | `src/modules/feed/photos.ts` `uploadPhoto` puts the bytes unchanged; `src/modules/closet/photos.ts` stores `original.{ext}` unchanged. No EXIF code in `src/`                             |
| Both upload surfaces go through blur                | `src/routes/feed/attach.$runId.tsx`, `src/routes/closet/$itemId.tsx` (only importers of `PhotoBlur`; D-102 / task 120)                                                                    |
| Garment photos owner-only; original + three sizes   | `src/routes/closet/photo.$itemId.$size.ts` (401/404 unless owner); `closet/photos.ts` `photoSizes`                                                                                        |
| Kit photos public once screened; owner sees own     | `feed/photos.ts` `isPhotoVisible`; `src/routes/feed/photo.$.tsx` (uses `optionalUserId`, so signed-out requests are answered)                                                             |
| Every photo screened by OpenAI, scores kept         | `src/modules/safety/classifier/moderation.ts` (`omni-moderation-latest`, image as base64); `schema-core.ts` `photoScreenings`; `closet/photos.ts` and `feed/photos.ts` call `screenPhoto` |
| Unscreened = owner only                             | `schema-core.ts` `entryPhotos.screenStatus` default `pending`; public reads require `pass` (`safety` `publicPhotoStatus`)                                                                 |
| CSAM scanning                                       | **Dashboard setting, not code.** `docs/workflow.md` launch-gate item 2; `moderation.ts` comment on `sexual/minors`                                                                        |

## What others see

| Claim                                                     | Source                                                                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kit and profile pages require sign-in                     | `src/routes/feed/entry.$entryId.tsx`, `src/routes/feed/u.$userId.tsx` (`requireSignedIn` in `beforeLoad`)                                                                                      |
| …but the data answers signed-out requests                 | `src/modules/feed/functions.ts` `entryDetailQuery` (`optionalUserId`), `otherProfileQuery` (no auth check)                                                                                     |
| Fields shown on a shared kit                              | `feed/entries.ts` `EntryDetail` / `getEntryDetail`                                                                                                                                             |
| Private kit returns nothing to others                     | `feed/entries.ts` (`if (!entry.isPublic && entry.userId !== viewerId) return undefined`)                                                                                                       |
| Public by default, per-kit, per-user default              | `schema-core.ts` (`isPublic` default true, `shareDefault` default true); `feed/share-default.ts`; `feed/entries.ts` `submitVerdict` sets `isPublic`; `onboarding/profile.ts` `savePreferences` |
| Anonymous conditions numbers, private and manual excluded | `src/modules/feed/consensus.ts` (`publiclyVisibleEntry`); `docs/architecture.md` "Your conditions (E2-lite)"; `docs/decisions.md` D-19                                                         |
| Blocks don't touch the counts                             | `schema-core.ts` `blocks` comment; `docs/contracts.md` blocks row                                                                                                                              |
| **Blocks not enforced**                                   | `src/modules/safety/blocks.ts` `hiddenCounterpartIds` / `isBlocked` are exported from `safety/index.ts` and imported by nothing else in `src/`                                                 |

## Strava

| Claim                                                | Source                                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Athlete id, tokens, expiry, status                   | `schema-core.ts` `stravaConnections`; `src/modules/runs/strava/oauth.ts` `completeStravaConnect`; `strava/api.ts` `exchangeResponseSchema` keeps only `athlete.id`               |
| Scope `activity:read`                                | `strava/oauth.ts` (`scope: "activity:read"`)                                                                                                                                     |
| Only connect, refresh, disconnect calls              | `strava/api.ts` (`TOKEN_URL`, `DEAUTHORIZE_URL` are the only endpoints); a repo-wide search for `strava.com` finds nothing else                                                  |
| Webhook keeps activity id, event type, time          | `strava/webhook.ts` (`webhookEventSchema`, message carries ids and `event_time` only, D-33); `runs/consumer.ts` `processReminderJob` → `processedWebhookEvents`                  |
| Notification points at the activity id               | `runs/consumer.ts` (`kind: "strava_reminder"`, `subjectId: job.objectId`, fixed body)                                                                                            |
| Never activity data                                  | Above, plus `docs/decisions.md` D-14, D-33; `docs/contracts.md` (`runs.source` has no Strava value)                                                                              |
| Disconnect deletes at once; token held until revoked | `strava/oauth.ts` `disconnectStrava` (one batch: delete connection + insert `stravaRevocations`); `runs/consumer.ts` `processRevokeJob` deletes the row after `deauthorize`      |
| Revocation from Strava's side marks broken only      | `strava/webhook.ts` returns early unless `object_type === "activity"` and `aspect_type === "create"`; `strava/oauth.ts` `refreshStravaToken` sets `broken` on a terminal failure |
| Reminders kept after disconnect                      | `disconnectStrava` touches `stravaConnections` and `stravaRevocations` only                                                                                                      |
| OAuth state cookie, 10 minutes                       | `src/modules/runs/functions.ts` (`strava_oauth_state`, `maxAge: 600`)                                                                                                            |

## Product lookups

| Claim                                       | Source                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server fetches, Firecrawl fallback          | `src/modules/enrichment/fetch-page.ts`, `enrichment/firecrawl.ts`                                                                                              |
| Page copy kept                              | `schema-core.ts` `productSnapshots`; `docs/contracts.md` "product_snapshots (retention)" ("never delete them")                                                 |
| Page text + URL to OpenAI, nothing personal | `enrichment/model/chat-completions.ts` (messages are the system prompt and `Page URL: ${url}\n\n${pageText}`); `enrichment/model/from-env.ts` (model constant) |
| Shared catalogue, creator recorded          | `schema-core.ts` `products.createdBy`; reportable as `subjectType: "product"` (`reports`)                                                                      |

## Moderation

| Claim                                                 | Source                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Signed-in reporting; threshold of three               | `src/modules/safety/functions.ts` `fileReportAction` (`requireUserId`); `safety/contracts.ts` `autoHideReporterThreshold = 3` |
| Kits and photos hidden, profiles/products queued only | `src/modules/safety/reports.ts` `hideWritesFor`                                                                               |
| Admins from config                                    | `src/env/env.d.ts` `ADMIN_USER_IDS`; `src/modules/safety/admin.ts`                                                            |
| Admins see hidden photos                              | `src/routes/safety/review-photo.$.tsx` → `feed/photos.ts` `reviewerPhotoResponse`                                             |
| Ban records reason and deletes sessions               | `src/modules/safety/bans.ts` `banUser`                                                                                        |
| **Ban not enforced**                                  | `banStateOf` / `bannedAmong` are imported by nothing outside `safety/`                                                        |

## Third parties

| Service         | Source                                                                                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare      | `wrangler.jsonc` (Workers, D1 ×2, R2 ×2, Queues, cron triggers, `observability.enabled`)                                                                                                       |
| Google          | `create-auth.ts`; `env.d.ts` `GOOGLE_CLIENT_ID/SECRET`                                                                                                                                         |
| Strava          | `src/modules/runs/strava/`                                                                                                                                                                     |
| Visual Crossing | `src/modules/weather/provider/visual-crossing.ts`                                                                                                                                              |
| OpenAI          | `safety/classifier/moderation.ts`, `enrichment/model/chat-completions.ts`; `env.d.ts` `OPENAI_API_KEY`                                                                                         |
| Firecrawl       | `enrichment/firecrawl.ts`; `env.d.ts` `FIRECRAWL_API_KEY`                                                                                                                                      |
| Sentry          | `src/modules/ops/sentry.ts` (Toucan, `setContext("dialed", context)`, no request attached); callers pass `surface` plus ids such as `userId`, `runId`, `importId`, `productId`, `revocationId` |
| HIBP            | PR #104                                                                                                                                                                                        |
| No analytics    | No analytics or tracking package in `package.json`; no third-party `<script>` in `src/routes/__root.tsx`; fonts self-hosted (`src/ui/fonts.css`, `public/fonts/`)                              |

The full list of outbound hosts in `src/` is: `api.openai.com`,
`api.firecrawl.dev`, `www.strava.com`, `weather.visualcrossing.com`, and
`openrouter.ai`. The last is used only by the offline eval, not in
production (`enrichment/model/from-env.ts` uses `OPENAI_ENDPOINT`), plus
whatever product URL a runner pastes.

## Cookies and storage

| Claim                       | Source                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Session cookie, 7 days      | `better-auth/dist/cookies/index.mjs` (`session_token`, default `maxAge` 7 days); `src/modules/auth/instance.ts` (`tanstackStartCookies`) |
| Short-lived sign-in cookies | `better-auth/dist/state.mjs` (`state` 300 s / `oauth_state` 600 s)                                                                       |
| Strava state cookie         | `runs/functions.ts` `STRAVA_STATE_COOKIE`                                                                                                |
| One localStorage key        | `safety/blur/preference.ts`; a search for `localStorage`, `sessionStorage` and `document.cookie` in `src/` finds nothing else            |

## Retention

| Claim                             | Source                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No deletion sweeps                | `src/modules/ops/crons.ts` (four crons: digest, weather retry, enrichment retry, screening retry; none deletes)                                       |
| No account deletion or export     | No such server function in any `src/modules/*/functions.ts`; Better Auth `deleteUser` not enabled in `create-auth.ts`                                 |
| No run, kit or kit-photo deletion | Same; the only `.delete(` calls in modules are blocks, reactions, entry tags (replaced on re-verdict), follows, garments, sessions (ban), Strava rows |
| Orphaned photos never expire      | `docs/deferred.md` D-27; `wrangler.jsonc` comment "MEDIA: no expiry"                                                                                  |

## Not in the policy, on purpose

- `docs/architecture.md` still says "photo screening via Workers AI" (launch
  gate) and "Photos render from R2 via cached public bucket URLs". Both are
  stale: screening is OpenAI (`architecture.md`'s own module notes say so)
  and photos go through `photoResponse`. The policy follows the code.
- `docs/architecture.md` mentions Turnstile on sign-up. No Turnstile code
  exists, so the policy does not name it; add Cloudflare Turnstile to the
  processor table if it is switched on.
