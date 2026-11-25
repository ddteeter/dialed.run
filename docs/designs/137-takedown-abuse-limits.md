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
  email alone. It is optional rather than in `/api/health`'s required
  list, so a deployment without it, or CI, stays healthy.
- **Filing decides whether the request hides**, reading before its batch:
  1. **Blocked** (either key is in `takedown_blocks`): recorded, receipt
     as usual, no hide, no operator alert.
  2. **Valve**: the valve counts kits, the distinct kits that something a
     request newly hid in the last hour is on, a kit photo counting as its
     kit, so a kit and its photos take one place between them. Once they
     are 10, a request whose subject is on none of them is recorded and
     hides nothing; one whose subject is already out of public view still
     holds it. A request the valve quiets alerts no one by itself; the
     operators get one "possible abuse" alert per hour, with a dedupe key
     per hour bucket.
     A request that newly hides nothing (a link that is not ours, one
     naming nothing a hold could move, or one holding a subject already out
     of public view) alerts every operator one by one only while fewer than
     10 such alerts went out in the hour, site-wide. Past that it owes the
     valve's hourly alert, and one that holds its subject still holds it.
     Such requests never count toward the valve, which counts hides.
  3. **Cap**: if this requester (either key) already has 2 pending
     requests, hidden or not, the request waits for a confirm before it
     hides or alerts. Counting every open request, not only hidden ones,
     also stops a flood of outside links from filling operators' inboxes.
  4. Otherwise it hides, as today.
- **Every receipt carries the confirm link** (`/takedown/confirm?token=…`)
  and names the link its request was filed with, so its reader confirms
  only their own. Pressing it proves the address (`confirmed_at`). A
  request past the cap also waits for it: confirming applies the hold
  through the same guards, the valve included. For any other request it
  records `confirmed_at` and nothing else; its receipt's link carries
  `for=address`, which chooses only the page's words. The page asks first,
  with a Confirm button and no write on GET, because mail scanners follow
  links.
- **Review** shows each request's state: `[hidden]`,
  `[waiting for confirm]`, `[valve]` or `[blocked]`. It shows the other
  open requests that share both of its keys ("2 more from this
  requester"), and offers **Block and decline all**. For a request still
  pending, that declines it and the pending requests sharing both its
  email key and its IP key (with no IP key, the request alone), with no
  outcome emails, and gives back what they hid through
  `releaseHoldWrites`. It adds the IP key to `takedown_blocks`, and the
  email key only when the pressed request was confirmed. The question says
  which it will block. A request already decided, or one a Take it down
  was recorded for, is answered as decided, and nothing is blocked.
- **Review's Blocked list** shows each block, newest first: an address by
  itself, a network by the address on the request it was blocked from.
  **Unblock** asks in place, then deletes the block, so what that key
  files next hides and alerts as usual.

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
    respects the valve; on a request that already acts it records
    `confirmed_at` only;
  - block-and-decline-all declines by both keys, blocks the email key
    only for a confirmed request, refuses a decided one, releases holds
    and sends no outcome emails.
- Worker (`takedown-blocks.test.ts`): the Blocked list and Unblock.
- DOM: Review's state brackets, the "N more" line, the block action and
  its question, the Blocked list and Unblock; the confirm page's states.
- Demo: extend `takedown.demo.spec.ts` with a third request that waits
  for a confirm.

## Open questions

- None blocking. The confirm page's and Review's words are placeholders
  until design gives them.
