## Answered in round 64 (imported 2026-11-27)

Design answered as `Round 64 Rulings.dc.html`, items 372–374, every one
in the table on the board, with the closed-account panels, the age
closure, both emails and the link's page drawn above it. The board's
text is the text of record. Design took the two notices as read: a
closed account can be deleted through a link the Desk sends to the
account's own address, with no sign-in, once, before it expires; an
under-18 closure schedules the deletion with no link; signing in stays
closed. Every email and page sentence was a proposal, and the owner
approved all of them as drawn (2026-11-27). The three items had no
issues; their build is one new issue.

**Desk › Runners: a closed account**

- **372 · changed, drawn.** "Send deletion link" is a QUIET_PILL beside
  Reopen, the same kind; neither is the panel's primary. Its ask replaces
  the pills in place: "Send a deletion link to m•••@hey.com? It works
  once, until Fri, Dec 4. Nothing is deleted unless they use it." with
  Send link (CHALK_PILL) and Cancel; the address is masked, Cancel
  returns focus to the pill, and a failed send fails on the row as NOT
  SENT. Statuses are MONO.sm brackets with one TYPE.small line:
  - `[SENT 27 NOV]`, "The link works until Dec 4. Reopening cancels it.":
    Reopen stays and the send pill goes, so one link is out at a time.
  - `[DELETES 5 DEC]`, "The runner confirmed on Nov 28.": no pills, and
    the row gains `[PENDING DELETE]` (R60·327's tags). The runner chose,
    so Reopen can't undo it.
  - `[LINK EXPIRED 4 DEC]`: Reopen and "Send again", whose ask is the
    same with a new date.

  The link lasts 7 days; the purge comes 7 days after it is used.

- **373 · changed, drawn.** The reason's label is "Under 18". It sits
  between the ten rules and Suspected CSAM, with a hairline on each
  side. While it is picked, a line above the submit reads "Closing for
  age also deletes the account on {date}. No link is sent.", and it stays
  if the submit fails. Closed: "Under 18 · closed {date}",
  `[CLOSED] [PENDING DELETE]`, `[DELETES {date}]` and "Reopening before
  then also cancels the deletion." There is no Send deletion link pill.
  Reopen stays for the 7 days, because the Desk made the call and can be
  wrong about an age. After the purge the row is gone. The age email
  names no rule.

**Email and the page it opens**

- **374.1 · changed, drawn.** The deletion-link email uses the account
  emails' layout. Subject "Delete your closed dialed.run account", kicker
  DELETE. Body: "Your account @runner_1290 is closed. If you want it
  deleted too, use this link. Your runs, closet, entries and photos go 7
  days after you confirm." One ink link, "Delete my account", then "The
  link works once, until Fri, Dec 4. If you'd rather keep the account
  closed, ignore this email and nothing happens." It doesn't say "you
  asked", because the Desk sends it. Dates are UTC.
- **374.2 · drawn.** The age closure email: subject "Your dialed.run
  account is closed", kicker ACCOUNT CLOSED. Body: "We closed
  @runner_1290 because dialed.run is for runners 18 and over. Your runs,
  closet, entries and photos will be deleted on Fri, Dec 4." No link,
  then "If we got your age wrong, reply to this email before then."
- **374.3 · changed, drawn.** The page is the link landings' ask (R27 #8,
  R60·324), not the signed-in delete sheet: no bars, MEASURE.panel, one
  ink button, pending brackets, and the ask comes first so that opening
  the link spends nothing. A failure shows the band NOT DELETED, "That
  didn't go through." Four states:
  - ask: "Delete your account?" / "@runner_1290 is closed. Deleting it
    removes your runs, closet, entries and photos on Fri, Dec 4. You
    can't undo this." with "Delete my account";
  - done: DELETION SCHEDULED, "Your account goes on Fri, Dec 4." / "We've
    sent an email saying so. There's nothing more to do.";
  - expired or unknown: LINK EXPIRED, "This link doesn't work any more." /
    "To ask for a new one, reply to the email it came in.";
  - already used: DELETION SCHEDULED, "This account already goes on Fri,
    Dec 4." / "The link was used. There's nothing more to do."
- **374.4 · changed.** Done also sends the existing delete-scheduled
  email, with its "Log in before…" line replaced by "If this wasn't you,
  reply to this email before {date}." The sheet's keep line can't apply
  to a closed account.

Read against the code at the import: the board's dates are examples
(Nov 27 closure, Dec 4 expiry, Dec 5 purge after a Nov 28 use); the
build computes them, in UTC, as every deletion date is (R40 C2).
