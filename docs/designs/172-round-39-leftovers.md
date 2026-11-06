# Design: 172 round 39 leftovers (design-deltas 66, 68, 69)

## Problem

Round 39 ruled on three screens the build has not caught up with: the
Strava consent's typography and its way back after a refusal (#66, D-143),
Review's quarantine at zero (#68), and Au2 telling a runner in Mississippi
or Tennessee that sign-up is closed *before* they fill in the form (#69,
D-141, R-159). The board is `design/Round 39 Rulings.dc.html`.

## Approach

**#66 · lead-ins.** `STRAVA_CONSENT` (`lib/copy.ts`) becomes paragraphs of
runs, `{ lead?, text }`, so the lead-ins are data rather than a second
list that names them. The words stay the owner's, colons included (the
board's periods are placeholder). `StravaConsent` renders a lead as
`<strong className="font-semibold">` inside the paragraph, at its size.
A derived `stravaConsentText(paragraph)` is the plain sentence the tests
and the e2e compare.

**#66 · P3.** `NowGoRun`'s StravaOffer drops "We read that a run happened.
Nothing else." The offer's "Connect Strava" becomes an `h2`, so there is a
heading to land on.

**#66 · Try again goes back where it came from, focus on the heading.**

```mermaid
sequenceDiagram
  P3->>/runs/strava-connect: ?from=onboarding (StravaButton prop)
  /runs/strava-connect->>Strava: 302, state=nonce; cookie nonce.onboarding
  Strava->>/runs/strava-callback: refused
  /runs/strava-callback->>Receipt: result + from (cookie, read and deleted)
  Receipt->>P3: Try again → /onboarding/done?again=1 (else /runs/strava?again=1)
  P3->>P3: focus the offer's h2 (T1: Page's h1)
```

The origin rides the existing `strava_oauth_state` cookie after the nonce
(`nonce.onboarding`; a ULID has no `.`), not the redirect_uri, so nothing
depends on Strava keeping a query string, and no new cookie name enters
the privacy policy's list (coordinator, 2026-11-05). `readStateCookie`
splits at the first `.`; the callback still compares `state` to the nonce
exactly, and the origin is parsed (`lib/strava-origin.ts`,
`z.enum(["onboarding"])`) — anything else means T1, never echoed. `again`
is a validated search param on both routes; `Page` gains `focusTitle` (h1 takes
`tabIndex={-1}` and is focused once on mount, via a ref callback).

**#68.** `QuarantineRecords` passes `whenEmpty`: "Nothing is in
quarantine." under `QUARANTINE · 0`, in BlockedRunners' empty-line style.
Review's foot is already Takedown, Copyright holds, Quarantine
(`routes/desk/review.tsx`); the delta line says so.

**#69.** Au2's loader also returns whether the request is placed in a
blocked state (`isFromBlockedRegion(getRequest())`, the one gate). If so,
`AuthPage` draws a `RegionClosed` notice in place of the form, Turnstile
and Google: kicker SIGN-UP CLOSED HERE, `REGION_COPY.signUp`, an Ask for
access link (ink, to Au5), and the existing "Have an account? Log in". The
refusal bands stay for a place that changes after load.

## Contract touches

- Schema changes needed: **none**
- New route files: **none**; search params added to `/runs/strava`,
  `/runs/strava-connect`, `/onboarding/done`
- New bindings/queues/crons: **none**. No new cookie: the state cookie's
  value gains an optional `.onboarding`.
- Screens: T1, T3 refused receipt, P3, D1 Review, Au2. Deltas 66, 68, 69.

## Test plan

- ui: `strava-consent.dom` — leads are `strong`, semibold, inside the `p`;
  each paragraph's text equals `stravaConsentText`; P3 has no retired line.
- worker: `oauth` — the state cookie carries `.onboarding` only for that
  origin, Strava sees the bare nonce; `readStateCookie` parses it back;
  a junk origin means T1; the nonce match stays exact.
- ui: `StravaCallbackResult` — Try again's href per `from`, `again=1`;
  none when full / unconfigured (kept).
- ui: `Page` focusTitle focuses the h1; NowGoRun `again` focuses the h2.
- ui: `QuarantineRecords` at zero says the sentence under the 0 heading.
- ui: sign-up page placed in TN/MS: notice, Ask for access href, Log in;
  no form, no Google, no Turnstile. Unplaced: the form, as before.
- e2e: strava spec's consent text via `stravaConsentText`; Review's empty
  quarantine. Region can't be placed locally, so #69 is dom-tested.

## Open questions

- P3's board frame draws a "Not now" in the offer; the ruling's text does
  not mention it. Proceeding without it (the screen already has Done for
  now).
- The board heads P3's offer "Remind me after a run"; the ruling does not
  rename it. Keeping "Connect Strava".
