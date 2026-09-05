# Task 106 — Trust & Safety Floor (LAUNCH GATE — sequential, after 101 + 104)

## Goal

The minimum safety layer required before public sign-ups open. Proportionate
for a solo operator: automated gates where automation is reliable,
report-driven review where it isn't, zero standing moderation workload.
Comments don't exist (D-04), which shrinks the surface.

This lane runs **after** 101 and 104 merge and may therefore touch
`modules/closet`, `modules/feed`, and `ui` — the parallel-ownership rules
don't apply because nothing else is in flight. Its schema additions
(reports, review_queue, domain_denylist, ban columns) are migrated on main
per the schema protocol before implementation.

## Scope

1. **Photo screening at upload** (garment photos and entry photos): classify
   via a Workers AI image-classification model before the photo becomes
   publicly visible.
   - Pass → visible immediately (the overwhelmingly common path).
   - Flag → `hidden_pending_review`; owner sees it with an "under review"
     badge, others don't; lands in the review queue.
   - Classifier failure → **fail open for the owner, closed for the
     public** (public visibility waits for retry via queue) — a Workers AI
     outage must not block anyone's own logging.
   - Document model + threshold in the design doc; include an eval against
     ~20 hand-picked benign running photos (sports imagery triggers false
     positives; tune before launch, not after complaints).
2. **Report → hide → review**: report affordance on entries, photos, and
   profiles. N reports from distinct users (default 3) auto-hides pending
   review. Review UI is a minimal admin-only page (approve / remove / ban);
   the daily digest includes queue depth. **Product names are UGC too**
   (D-26): reportable, and review can set `products.status='hidden'`
   (hidden products drop out of autocomplete; linked garments fall back to
   their own text fields).
   2b. **Product duplicates report** (D-30): a read-only admin list of probable
   duplicate products (same brand, near-identical normalized names). No
   merge tooling in v1 — the report just makes the mess visible.
3. **Link hygiene** for product URLs: https-only (already enforced in 101),
   rendered with `rel="ugc nofollow noopener"`, bare domain displayed next
   to link text, checked against a denylist table (seeded empty; review
   flow can add domains).
4. **Ban mechanics**: banned user's content hidden everywhere, sessions
   revoked, sign-in blocked. No appeal flow at MVP (email in the ban notice).
5. **Caption/note text**: no automated filter at MVP — report-driven
   only. Document as deliberate (precision/recall at this scale).

## Explicitly configured outside this lane (human, in dashboard)

Cloudflare's CSAM scanning tool — zone setting, not code; carried on the
workflow.md launch checklist.

## Out of scope

Comments (still don't exist — deliberate), appeals workflow, trusted-flagger
tiers, ML text moderation, per-country rules, DMCA tooling (contact email in
the footer; manual process).

## Test expectations

- Visibility matrix: pending/flagged/hidden/banned content — owner sees /
  public doesn't, across feed (both tabs), entry detail, profile, and the
  consensus aggregate (hidden content must not count).
- Report threshold auto-hide, including the distinct-users requirement.
- Classifier failure path: owner-visible, public-hidden, retry enqueued.
- Denylisted domain rejected at save with a user-facing message.

## Done criteria

Design doc reviewed (include the model/threshold eval results — this lane's
design doc IS a hard stop, schema + model choice both). Verify + tests
clean. Manual walkthrough: upload a flaggable image → invisible to a second
local user → appears in review queue → approve → visible.
