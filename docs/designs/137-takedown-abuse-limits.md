# Design: 137 /takedown abuse limits

## Problem

Since round 35 #58e, a `/takedown` request whose link is ours hides it at
once, and anyone can file one. The only guards are Turnstile and five
requests per IP per hour. Someone with many inboxes and IPs could hide
photo after photo, and Review cannot tell their requests apart.

## Approach

Owner's calls (2026-10-10): cap **2** open hides per requester, a
**10 per hour** site-wide valve, and a **silent receipt** for a blocked
requester.

- **Requester key** (`safety/requester-key.ts`). validator's
  `normalizeEmail` (Gmail dots and `googlemail`, Outlook, iCloud and Yahoo
  subaddresses, lowercase), then strip a `+tag` on any other domain. It
  is only ever compared, never sent to.
- **IP key.** HMAC-SHA-256 of the visitor's IP under a new secret,
  `TAKEDOWN_SECRET` (owner, 2026-10-10). Raw IPs are never stored. With
  the secret missing, the IP key is absent and requests are matched by
  email alone; `/api/health` names it.
- **Filing decides whether the request hides**, reading before its batch:
  1. **Blocked** (either key is in `takedown_blocks`): recorded, receipt
     as usual, no hide, no operator alert.
  2. **Valve**: if 10 requests have hidden something in the last hour, the
     request is recorded and hides nothing. The request that trips it
     sends one "possible abuse" alert per hour, with a dedupe key per
     hour bucket.
  3. **Cap**: if this requester (either key) already has 2 pending
     requests that hid something, the request waits for a confirm. The
     receipt email carries a link to `/takedown/confirm?token=…`. That
     page asks first, with a Confirm button and no hide on GET, because
     mail scanners follow links. Confirming applies the hold through the
     same guards, the valve included.
  4. Otherwise it hides, as today.
- **Review** shows each request's state: `[hidden]`,
  `[waiting for confirm]`, `[valve]` or `[blocked]`. It shows the
  requester's other open requests ("2 more from this requester"), and offers **Block and decline
  all**. That declines every pending request from either key with no
  outcome emails, gives back what they hid through `releaseHoldWrites`,
  and adds both keys to `takedown_blocks`.

## Contract touches

- Schema, additive, migration `0055_add_takedown_abuse_limits`:
  - `takedown_requests` gains nullable `requester_key`, `ip_key`,
    `held_at`, `hold_state` (`held` | `confirm` | `valve` | `blocked`),
    `confirm_token_hash` and `confirmed_at`;
  - indexes on (requester_key, status), (ip_key, status) and (held_at);
  - a new table `takedown_blocks` (`key` PK, `kind` email|ip,
    `created_at`, `created_by`).
- Binding: the **`TAKEDOWN_SECRET` secret** (owner sets it; no
  `wrangler.jsonc` change).
- Route: `/takedown/confirm`. Undesigned: SignedOutPanel, one line, one
  button. It goes in design deltas.
- Dependency: `validator` 13.15.35 and `@types/validator`, server-only.

## Test plan

- Worker (`requester-key.test.ts`): Gmail dots, `googlemail`, `+tag` on
  every domain, Yahoo `-tag`, case, and an address left alone.
- Worker (`takedown-abuse.test.ts`):
  - the cap on either key;
  - the valve and its one alert per hour;
  - a blocked requester gets a silent receipt;
  - confirm applies the hold once, is refused after a decision, and
    respects the valve;
  - block-and-decline-all releases holds and sends no outcome emails.
- DOM: Review's state brackets, the "N more" line and the block action;
  the confirm page's two states.
- Demo: extend `takedown.demo.spec.ts` with a third request that waits
  for a confirm.

## Open questions

- None blocking. The confirm page's and Review's words are placeholders
  until design gives them.
