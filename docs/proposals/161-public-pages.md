# Proposal — Public pages: kits and profiles the open web can see

**Status**: approved (owner, 2026-10-25). Decisions 1–6 were ruled as
recommended and are D-150 (1, 3, 4), D-151 (2), D-152 (5) and D-153 (6);
decision 4 adds that a choice of coarser dates can come later. Decision 7
went to design as item 86: round 41 named the audience PUBLIC and drew
every surface (`docs/design-deltas.md`, "Answered in round 41"). The build design is `docs/designs/161-public-pages.md`.

## Why

Today a dialed.run link leads a stranger nowhere. D-58 keeps every entry
and profile behind sign-in, D-107 gives every link the generic card, and
during invite-only a click ends at a code wall. Sharing a kit — "38°F,
overcast, here's what I wore" on Reddit, a rotation page linked from a
Strava bio, a race kit — is the natural way a runner shows dialed.run to
someone who has not heard of it. This proposal lets a runner opt a kit,
and separately their profile, into the open web.

The share card matters more than the page: most people who see a link in a
thread never click it. A card that shows the kit, the conditions and the
verdict is the advertisement.

## What changes for a runner

- **A fourth audience, `world`** (D-109's enum gains a value). Chosen per
  kit, never by accident: it is not the launch default. `runners` keeps
  meaning signed-in runners, so no kit shared today becomes public.
- **A public profile is its own switch** (Settings › Sharing), off by
  default. A `world` kit is viewable on its own link whether or not the
  profile is public; it links to the profile only when the profile is.
- **A public profile can show the closet as a rotation**: pieces in use,
  shoe mileage, retired pieces. A second switch under the first.
- **Undoing is immediate in the app, near-immediate on the web**: switching
  a kit back to `runners` or `private` takes it off dialed.run's public
  pages within the cache window (design doc: about a minute). A card that
  another site already copied (Reddit, iMessage, Slack keep their own copy)
  cannot be recalled; the audience picker says so.

## What a public kit shows

| Shown                                                 | Never shown                                     |
| ----------------------------------------------------- | ----------------------------------------------- |
| The kit: pieces, as product links where linked        | Start time, time of day                         |
| The verdict (5-state label)                           | Location, coordinates, route, map               |
| Feels-like and sky, with the Visual Crossing credit   | Per-item flags and notes (private to the owner) |
| Distance, moving time, pace, elevation gain           | Verdict history, coverage charts, thermal level |
| Caption; the photo once photo coverage is on (below)  | Anything from Strava (never stored at all)      |
| Handle; the run's date (granularity: open question 4) | Anyone's follows, Usefuls or reports            |

Leaving out time and place is the safety line: a runner who posts every
morning at 6:10 under the same sky can be narrowed to a city and a routine.
Stats from a Garmin-sourced run follow the Garmin integration's attribution
(design 157).

## Photos

World-public photos follow R-153's publish-and-unpublish design: a photo
that passed screening on a `world` kit is copied to a public R2 bucket on a
custom domain under an unguessable key, served from Cloudflare's cache, and
deleted and purged on any hide, takedown, ban or audience change. Served
from the cache, those photos are what Cloudflare's CSAM Scanning Tool
scans, so world photos do not wait on PhotoDNA (D-129 stays the plan for
upload-time matching of every photo). `runners` photos stay private behind
sign-in (D-69 unchanged for them).

## Not changing

- **`noindex` on people's pages (D-53).** Public pages are for sharing, not
  search; product and guide pages are the search surface. Opt-in indexing
  for a public profile is a later question.
- **Published anonymous totals (D-108)** are unaffected: they already count
  private runs by the counted fields only.
- **18 and over (design 134)** already covers every account.

## Decisions the owner rules on

| #   | Decision                                                                                                                                                                                                                | Recommendation                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | Revise D-58: "public" can mean the open web, for kits and profiles a runner opts in. Copy and the privacy policy follow.                                                                                                | **Yes** (owner, 2026-10-25). New D-number superseding D-58 in part.                                 |
| 2   | Revise D-107: a `world` kit's link previews as its own card (the round 26 #22 card, revived from R-150, with R-160's credit). Every other link keeps the default card.                                                  | Yes                                                                                                 |
| 3   | Can `world` be a runner's default audience?                                                                                                                                                                             | Only once their profile is public; otherwise per kit                                                |
| 4   | What date does a public kit show: the day, the week, or "3 days ago"?                                                                                                                                                   | The day. Date plus conditions narrows to a region, not a street                                     |
| 5   | Revise D-69 for world photos only (above), with the public bucket and custom domain as owner-made binding and dashboard changes.                                                                                        | Yes                                                                                                 |
| 6   | URLs: `/k/<entryId>` for a public kit; `/@handle` becomes the public profile, and the signed-in profile (H) moves to `/feed/u/<handle>`. Public URLs then never vary by viewer, which is what makes them safe to cache. | Yes (design doc, Approach)                                                                          |
| 7   | User-facing names: the new audience's label next to SHARED and PRIVATE, and the Settings wording.                                                                                                                       | Owner's wording; "PUBLIC" collides with D-58's old meaning in shipped copy, so a sweep goes with it |

## Phases

1. **Contract**: the `world` value, the visibility rules, the profile
   switches (a schema change, so it stops for review), the picker and
   Settings. Nothing renders publicly yet.
2. **Public kit page and card**: `/k/<entryId>`, text only (kit, verdict,
   conditions, stats), the share card, the signed-out call to action
   ("Get your own Call"), a report link to `/takedown`.
3. **Public profile and rotation**: `/@handle` and the closet view.
4. **World photos**: the public bucket, behind a switch that turns on once
   the bucket, the custom domain and the CSAM Scanning Tool are live.

Phase 1 needs no design boards. Phases 2–3 need boards for the public kit
page, the public profile, the card and the signed-out call to action:
requested from design alongside phase 1.
