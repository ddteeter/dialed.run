# Task 105 — Trust & Safety Floor (LAUNCH GATE — sequential, after 101 + 104)

## Goal

The minimum safety layer required before public sign-ups open. Proportionate
for a solo operator: automated gates where automation is reliable,
report-driven review where it isn't, and zero standing moderation workload.

This lane runs **after** 101 and 104 merge and may therefore touch
`modules/wardrobe`, `modules/feed`, and `ui` — the parallel-ownership rules
don't apply because nothing else is in flight.

## Scope (from the original product brainstorming)

1. **Photo screening at upload** (both wardrobe item photos and entry
   photos): classify via a Workers AI image-classification model before the
   photo becomes publicly visible.
   - Pass → visible immediately (the overwhelmingly common path; no UX drag).
   - Flag → photo `hidden_pending_review`, owner sees it with a "under
     review" badge, others don't see it at all; lands in the review queue.
   - Classifier failure → **fail open for the owner, closed for the public**
     (owner sees it, public visibility waits for retry via queue) — a
     Workers AI outage must not block anyone's own logging.
   - Document the chosen model + threshold in the design doc; include an
     eval against ~20 hand-picked benign running photos (sports imagery
     triggers false positives; tune before launch, not after complaints).
2. **Report → hide → review**: a report affordance on entries, photos, and
   profiles. N reports from distinct users (default 3) auto-hides the
   content pending review. All reports land in a `review_queue` table.
   Review UI is a minimal admin-only page (approve / remove / ban); the
   daily digest includes queue depth so an empty queue costs zero attention.
3. **Link hygiene** for user-entered product URLs: https-only (already in
   101), rendered with `rel="ugc nofollow noopener"`, display the bare
   domain next to the link text, and check against a small denylist table
   (seeded empty; the review flow can add domains).
4. **Ban mechanics**: a banned user's content is hidden everywhere, sessions
   revoked, sign-in blocked. No appeal flow at MVP (email in the ban notice).
5. **Caption/note text**: no automated filter at MVP — report-driven only.
   Document this as a deliberate decision (automated text moderation has a
   miserable precision/recall tradeoff at this scale; reports are cheaper
   and better).

## Explicitly configured outside this lane (human, in dashboard)

Cloudflare's CSAM scanning tool — enable it on the zone (free; hash-matches
served images and handles NCMEC reporting). This is a dashboard setting, not
code; workflow.md carries it as a launch-gate checklist item.

## Out of scope

Comments (still don't exist — deliberate), appeals workflow, trusted-flagger
tiers, ML text moderation, per-country content rules, DMCA tooling (add a
contact email in the footer; process is manual at this scale).

## Test expectations

- Visibility matrix: pending/flagged/hidden/banned content — owner sees /
  public doesn't, across feed, entry detail, and profile.
- Report threshold auto-hide, including the distinct-users requirement.
- Classifier failure path: owner-visible, public-hidden, retry enqueued.
- Denylisted domain rejected at save with a user-facing message.

## Done criteria

Design doc reviewed (include the model/threshold eval results). Verify +
tests clean. Manual walkthrough: upload a flaggable image → invisible to a
second local user → appears in review queue → approve → visible.
