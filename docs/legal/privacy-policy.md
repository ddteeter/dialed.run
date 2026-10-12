<!--
  Publishing this text (task 126, ACC-13). /privacy shows this file only
  once its first three lines are exactly these, with nothing above them:

  ---
  published: true
  ---

  Add them when the text is final and reviewed. Until then /privacy
  answers "not found", whatever the text below says. The page never shows
  those three lines or this note.
-->

> **DRAFT: not reviewed by a lawyer.** Written from the code on `main` as of
> 2026-10-11 for the owner to edit. Every `[OWNER: …]` note is a decision or
> a fact the code cannot supply. Every factual claim is mapped to the code
> that makes it true in `privacy-policy-sources.md`; change one, change both.

# [dialed.run] privacy policy

Effective: [OWNER: date this is published]

[dialed.run] is a log of what you wore on your runs and how it worked. This
page says what we keep, why, who else touches it, and what you can do about
it. Where something is not built yet, it says so.

## Who we are

[dialed.run] is run by one person, [OWNER: your legal name, while there is
no company. Once Big Long Run Labs LLC is formed, it becomes the operator:
replace this line with the LLC's name, and change the terms' "Who we are"
paragraph and their definition of "we" in the same edit], [OWNER: a postal
address, if you publish one; none is in the code].

Questions about this policy or your data: hello@dialed.run.

## The short version

- We keep your account, your closet, your runs and your kits. That is the
  product.
- Kits you share are seen by other signed-in runners, and shared is the
  default. You can make any kit private, or make private your default.
  Nothing is shown to people who are not signed in.
- Locations are kept to about a kilometre, and no run's location is shown
  to anyone. We do not keep your route.
- Faces in your photos are blurred on your phone before upload, unless you
  turn that off. Every photo is re-encoded on our servers, so none keeps
  the camera's metadata.
- From Strava we keep your athlete id and one token used only to revoke our
  access. Never your activity data.
- No ads. The app runs no analytics; the marketing site counts page views
  without cookies (see [Cookies](#cookies-and-browser-storage)). No selling
  or renting your data. [OWNER: confirm "no ads" and "no selling or
  renting" are commitments you will keep; the code makes them true today.]
- You can export your data and delete your account in Settings › Account.

## What we keep, and why

### Your account

- **Email address.** To sign you in, to tell accounts apart and to send
  you account email. We keep no name: on dialed.run you are your username.
- **The invite code you signed up with**, and the address that used it,
  while sign-up is invite-only, so we can see who each code let in.
- **Not your date of birth.** Sign-up asks for it to check you are 18 or
  over, and we do not keep it (see [Children](#children)).
- **A request for access**, if you make one: the email address, the note
  you leave, and whether we invited you or declined. We keep it after we
  answer. [OWNER: no period is set; nothing deletes a request unless the
  address later makes an account and deletes it. Choose one, for example
  "deleted 90 days after we answer", or keep "until we delete it".]
- **Your password, hashed.** We store a scrypt hash, never the password
  itself. When you set a password we check it against Have I Been Pwned's
  list of leaked passwords. Only the first five characters of the
  password's SHA-1 hash leave our servers; the password and the full hash
  never do. If that check cannot answer, your password is accepted.
- **If you sign in with Google:** Google gives us your name, email address,
  profile picture link and Google account id. We keep the email address,
  the picture link and the account id; we do not keep your name. We ask
  for the `openid`, `email` and `profile` permissions only. We also store
  the tokens Google issues at sign-in.
- **Sessions.** When you sign in we record a session token, when it expires
  (7 days), the browser that signed in, and its IP address (as Cloudflare
  reports it). [OWNER: launch gap, still real. Nothing deletes a session
  row once it expires; it goes only on sign-out, a ban or account
  deletion. Decide a sweep (for example, delete rows 30 days past expiry)
  or say here that they are kept until the account is deleted.]
- **Counts that stop abuse.** We count sign-in and sign-up attempts per IP
  address; those counts are kept for about a minute and then deleted. We
  count how many sign-in links, password resets and email changes each
  address asked for in the last hour, and how many wrong passwords you
  typed when changing your email. Requests for access and removal requests
  are counted per visitor IP address the same way. [OWNER: the per-IP rows
  for requests for access and removal requests are never deleted; each
  holds one IP address and a count. Decide a sweep or accept and say so.]
- **Terms you accepted:** each version and when.
- **Account email.** We send email from hello@dialed.run through
  **Cloudflare's** email service: confirming your address, a notice when
  someone tries to sign up with it, password reset, email change (to both
  addresses), invites, run reminders, your export link, notices that we
  removed something of yours or closed or reopened your account, that
  your account is due to be deleted, and that Strava reminders stopped.
  Run reminders can be turned off; the rest are about your account and
  always send. We send nothing commercial. An email we owe but have not
  sent yet waits in a queue with its address until it goes.

### Your profile

- **Username** and **the place you run**, if you set it. Both show on
  your profile to other signed-in runners.
- **Username screening.** When you pick a username we check it against a
  list of offensive words and send it, alone, to **OpenAI's** moderation
  service. Nothing else about you goes with it.
- **Usernames you have used.** When you change your username, or delete
  your account, the old one is kept for good so nobody else can take it.
- **Coordinates for that place**, if you let your browser share your
  location, rounded to two decimal places (about a kilometre) before they
  are stored. They are never shown to anyone. They stand in for a run's
  location when a manual run has none.
- **How warm or cold you run** (your thermal level), your units, whether
  your kits are shared by default, and which emails you have switched off.
  Your thermal level is never shown to anyone else.

### Your closet

Each garment you add: category, brand, model name, size, colour, and the
attributes you choose (layer, weight, fabric, wind and water resistance,
visibility), a product link if you paste one, and a photo if you take one.

### Your runs

- **Manual runs:** start time, duration, distance, title, effort, and whether
  it was indoors.
- **Imported files (GPX, FIT, TCX, up to 25 MB):** we store the file, read
  the start time, duration, distance and **the first GPS point** from it, and
  save those to the run, with the point rounded to about a kilometre. The
  run keeps only that rounded start point, not the route. **Once the file
  has been read, we delete it**, usually within a day; we do not keep your
  route. If we could not read a file, there is no run, so we keep the file
  for 30 days after the import failed, in case you ask about it, and then
  delete it.
- **Conditions:** the weather for each hour of the run, looked up from its
  start point and time (see [Weather and location](#weather-and-location)).
  If the weather cannot be found, you can set a temperature yourself; that
  run is then left out of everyone's conditions numbers.

### Your kits

For each run you log a kit on: the garments you wore, your verdict (way cold
to way warm), an optional caption, tags, up to four photos, and optional
notes and flags on individual garments. Notes and flags on garments are only
ever shown to you.

### The social side

- **Follows**, and **"useful"** marks you give kits.
- **Reports** you file: what you reported, the reason, and any note you add.
- **Blocks** you set.
- **Notifications** we create for you, such as a reminder to log a kit.

## Weather and location

- **Run weather.** To find the conditions for a run, our servers send the
  run's start point, rounded to about a kilometre, and its date to
  **Visual Crossing**, our weather provider. Your name, email and account
  id are not sent. The answer is kept in a shared weather cache keyed by
  that rounded location and the hour, alongside a reference to the run
  that first fetched it.
- **Setup.** To suggest a starter closet, the place you typed or your
  rounded coordinates are sent to Visual Crossing to look up typical
  winter and summer temperatures there.
- **"Your conditions" on the feed.** If you allow it, your browser sends
  your current location to our server to look up recent weather near you
  from the cache. It is not stored, and it is not sent to Visual Crossing,
  unless you choose to save it as the place you run, when it is rounded
  and stored as above.
- **Time zone.** A run's local time comes from the time zone Visual Crossing
  reports for the place.
- **Never shown.** No run's coordinates are shown to anyone, including on
  shared kits.

## Photos

- **Faces are blurred before upload, by default.** Face detection runs in
  your browser; the model is loaded from our own site and your photo does not
  leave your device for it. Blurred areas are pixelated, not softened, so
  they cannot be recovered. You can also tap to blur anything else.
  Turning blur off is remembered in your browser only.
- **No photo keeps its metadata.** Every photo, kit or garment, blur on or
  off, is decoded and saved again as a new JPEG on our servers, so nothing
  the camera wrote, including any GPS location, is kept or shown.
- **Garment photos** are only ever shown to you. We keep the photo you
  uploaded, re-encoded, and three resized copies.
- **Kit photos** are shown to signed-in runners who can see the kit, once
  screened.
- **Screening.** Every photo is sent to **OpenAI's** moderation service to
  check for sexual, violent and self-harm content. We keep the scores it
  returns. A photo that scores high is hidden from everyone but you until a
  person reviews it. Until a photo is screened, only you can see it.
  [OWNER: decide CSAM coverage before public launch (D-69, deployment plan
  §8): a cached public bucket that Cloudflare's CSAM Scanning Tool can see,
  or PhotoDNA. Cloudflare's tool cannot see photos as they are served
  today. Once one is on, name it here and in the processor table.]

## What other people can see

**Only signed-in runners.** "Shared" means other signed-in runners on
[dialed.run], not the open web. Kits, profiles and their photos are not
shown to anyone who is not signed in, and are not indexed by search
engines. A link to a kit shared elsewhere previews as a generic
[dialed.run] card, with nothing from the kit on it.

**A shared kit** shows your username, the run's title, date and start time, distance,
duration, whether it was indoors, its conditions, the garments you wore
(name, brand, category, layer), your verdict, caption, tags, screened photos,
and how many people marked it useful.

**Your profile** shows your username, the place you run, and your recent
shared kits.

**Never shown to anyone else:** your email, your closet as a whole, your
garment photos, your private kits, notes and flags on garments, your thermal
level, your verdict history and coverage, and any run's coordinates.

**Sharing is on by default.** You choose shared or private for each kit when
you give the verdict, and you can make private your default in settings.
Until you confirm your email address, the kits you log are saved private.
Private kits never appear in feeds or in anyone's conditions numbers.

**Conditions numbers.** Shared kits are counted, without names, in numbers
like "15 of 18 wore long sleeves" for runners in similar weather. Blocking
someone does not remove their kits from these counts, because the counts
name no one.

**Blocking** hides the two of you from each other: each other's kits in
feeds and on kit pages, each other's profiles, and each other in search.
It does not notify them.

## Strava

Connecting Strava is optional. It exists for one thing: a reminder to log
your kit when you post a new run there.

- **What we keep:** your Strava athlete id and a refresh token, which we
  use for one thing only: revoking our access. We do not keep the access
  token Strava issues, or when it expires.
- **Permission:** we ask for `activity:read`, the narrowest permission for
  which Strava tells us about new runs. Runs you post on Strava as visible
  to "Only You" do not reach us and get no reminder. We never use the
  permission to read an activity: our code calls Strava only to connect
  and to revoke our access.
- **When you post a run on Strava,** Strava tells us an activity id, your
  athlete id and a time. We keep the activity id, the event type and that
  time so we never remind you twice, and we create a notification that
  points at that activity id. **After 7 days we delete the activity id**
  from both, whether you are still connected or not; the reminder itself
  stays, with no Strava data in it. [OWNER: launch gap, still real
  (register R-142). If a reminder fails every retry, the failure record
  keeps your athlete id and the activity id until we retry or drop it,
  even after you disconnect or delete your account. Fix before public
  launch, or say so here.]
- **Never:** distance, pace, route, title, photos, heart rate or any other
  activity data. We do not store, show or use it.
- **Disconnecting** deletes the connection immediately. We keep the refresh
  token only in a queue of revocations until Strava confirms it has revoked
  our access, then delete it.
- **If you revoke us from Strava's side,** Strava tells us, and we delete
  the connection straight away, revoke with the refresh token in the same
  way, and tell you that reminders have stopped.

## Product lookups

When you paste a product link, **our servers** (not your browser) fetch
that page, directly or through **Firecrawl** when the shop blocks us. We keep
a copy of the page and may send its text and address to **OpenAI** to read
the fabric and composition. Nothing about you is sent with it.

Products are a shared catalogue. A product you add, and its name as you
typed it, can be seen by other runners and reported by them. We record which
account added it.

## Moderation

- Signed-in runners with a confirmed email can report a kit, a photo, a
  profile or a product name. A kit you report leaves your feed straight
  away, and a runner you report leaves your search. When three different
  people report the same kit or photo, it is hidden from everyone but its
  owner and a person reviews it. A profile or product name reported three
  times goes to a person for review.
- One report that a kit or photo is an intimate image shared without
  consent hides it from everyone but its owner at once, and emails each
  reviewer that it is waiting and when its 48 hours run out. The email
  says what kind of thing was reported and when; it does not name you or
  the runner who posted it.
- **A removal request** made at [/takedown](/takedown), with or without an
  account: we keep the email address, the name typed as a signature, the
  link or description of where the image is, anything written about it,
  when it was made, and what we decided, with the reason if we declined.
  If the link points to a kit or photo on [dialed.run], we hide it from
  everyone but its owner while we look, and put it back if we decline.
  We email the address a receipt and the decision, and email each
  reviewer that a request is waiting. We count requests per visitor IP
  address, as we do requests for access, to stop the form being flooded.
  We keep a request until we delete it, because it is the record of why
  something was or was not removed.
- Reviewers are the people who run [dialed.run], named in our
  configuration; today that is one person. They can see reported and
  flagged content, including hidden photos, with the reports' reasons and
  notes.
- **When we remove a kit or photo,** we delete it and its files, keep a
  record of what was removed, by whom and why, and tell its owner in the
  app and by email. A moderator can also change a username that breaks the
  rules, and the runner is told why the next time they open the app.
- **Suspected child sexual abuse material** is the exception: it is
  removed at once, and its owner is not told. We keep a locked copy that
  only reviewers can see, with who uploaded it and when, for one year so
  it can be reported to the National Center for Missing & Exploited
  Children, and then delete it.
- **We can close an account.** We record the reason, sign it out
  everywhere, refuse it sign-in, hide its kits, photos and profile from
  everyone else, and email the reason. Reopening it brings them back.

## Who else handles your data

We use these services to run [dialed.run]. We do not sell or rent your data
to anyone.

| Service                  | What it does for us                                                     | What it receives                                                                                          |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cloudflare               | Hosts the app: servers, databases, photo and file storage, queues, logs | Everything above, stored on its platform                                                                  |
| Cloudflare Email Service | Sends our email                                                         | Each email's address, subject and body                                                                    |
| Cloudflare Turnstile     | Tells people from bots on sign-up, request access and removal requests  | The check your browser runs, and your IP address from our server                                          |
| Google                   | "Sign in with Google", if you use it                                    | The sign-in request; returns your name, email and picture                                                 |
| Strava                   | Run reminders, if you connect                                           | The connect and revoke requests                                                                           |
| Visual Crossing          | Weather                                                                 | Rounded run start points and dates; the place you set                                                     |
| OpenAI                   | Photo screening; username screening; reading product pages              | Your photos; the username you pick; the text and address of product pages                                 |
| Firecrawl                | Fetching product pages that block us                                    | The product link                                                                                          |
| Sentry                   | Error reports                                                           | The error and internal ids (account, run, import, product), never tokens, request bodies or file contents |
| Have I Been Pwned        | Leaked-password check                                                   | The first five characters of your password's SHA-1 hash                                                   |

[OWNER: where Cloudflare stores the databases and buckets. The code sets no
location hint or jurisdiction, so Cloudflare picks one. Decide whether to
pin one, and, since sign-up stays open to the EU and UK (D-115), whether to
add a transfer statement (for example, "your data is stored and processed
in the United States") and which safeguard it relies on.]

## Cookies and browser storage

- **A session cookie** keeps you signed in, for up to 7 days.
- **Short-lived cookies during sign-in**, including one that lasts 10
  minutes while you connect Strava, stop the sign-in or connection being
  hijacked.
- **An age-check cookie**, only if sign-up refused a date of birth as
  under 18, for one day (see [Children](#children)).
- **In your browser's storage:** whether you turned face blur off, so we
  do not load the face detector again; your account id, so a tab knows
  when you have signed in as someone else; and, for one tab and only
  until you close it, your email address if you were signed out mid-form,
  so the sign-in form can fill it in.

No advertising or analytics cookies. Our fonts and the face-blur model are
served from our own site. The one third-party script is Cloudflare
Turnstile's, loaded only on sign-up, request access and the removal
request form.

dialed.run (the marketing site) counts page views with GoatCounter, which
sets no cookies and keeps no personal data.

## How long we keep it

| What                                                                                            | How long                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Imported run files                                                                              | Until it has been read, usually within a day. A file we could not read: 30 days after the import failed                                                    |
| Your data export                                                                                | The file: 7 days from when it is ready. The record that you asked for one: deleted with the file, or 7 days after a failed export                          |
| Removal requests (`/takedown`)                                                                  | Until we delete them                                                                                                                                       |
| Requests for access                                                                             | Until we delete them [OWNER: see "A request for access" above]                                                                                             |
| Session records                                                                                 | Expire after 7 days; the record is kept until sign-out, a ban or account deletion [OWNER: see "Sessions" above]                                            |
| Strava refresh token                                                                            | Until you disconnect, then until Strava confirms revocation                                                                                                |
| Strava activity ids                                                                             | 7 days                                                                                                                                                     |
| Garments you delete                                                                             | Deleted with their photo files. A garment you wore leaves those kits                                                                                       |
| Runs, kits and kit photos you delete                                                            | Deleted with their files                                                                                                                                   |
| Your account, when you delete it                                                                | Hidden at once; everything below deleted 7 days later (see [Your choices](#your-choices))                                                                  |
| Suspected child sexual abuse material we removed                                                | One year, then deleted                                                                                                                                     |
| Usernames you have used                                                                         | For good, so nobody else can take them                                                                                                                     |
| Everything else: account, profile, runs, kits, photos, follows, reports, notifications, weather | Until you delete it or your account [OWNER: no period is set for an account nobody deletes, or for the weather cache. Decide one, or keep "no time limit"] |
| Server logs                                                                                     | [OWNER: Cloudflare Workers Logs keep 3 days on Workers Free and 7 on Workers Paid; say which plan]                                                         |
| Error reports                                                                                   | [OWNER: Sentry's retention for your plan]                                                                                                                  |
| Product pages we fetched                                                                        | Kept, to re-read later. Not personal data                                                                                                                  |

## Your choices

What you can do in the app:

- **Export your data.** Settings › Account › Export your data emails you a
  link to one ZIP: your profile, runs (with the conditions we showed),
  kits, closet, the terms you accepted, and your photos at the size we
  keep. One a day; the link works for 7 days, and only for you, signed in.
- **Delete your account.** Settings › Account › Delete account. You are
  hidden from everyone at once, and you have 7 days to change your mind by
  signing in and keeping it. After that we delete your account, profile,
  closet, runs, kits, photos, files, follows, blocks, notifications and
  Strava connection. What stays: your username, reserved for good; reports
  you filed, without your name; records of moderation decisions and any
  quarantined material; and products you added to the shared catalogue,
  no longer linked to you.
- **Delete a run, a kit or a kit photo**, and **delete or retire a
  garment.**
- **Change your email address** (confirmed from the new address, with a
  notice to the old) and **reset a forgotten password** by email.
- **Switch off run reminder emails** in Settings › Notifications, or from
  the unsubscribe link in any of them.
- Make any kit private, and make private your default.
- Turn face blur off or on, per device, and blur anything by tapping it.
- Disconnect Strava.
- Unfollow, remove a "useful", block, unblock, and report.
- Allow or refuse location in your browser. Everything works without it; a
  run without a location gets no automatic weather.

For anything else, such as correcting something you cannot edit, or a
question about what we hold, email hello@dialed.run and we will answer
within [OWNER: a number of days; GDPR allows one month]. [OWNER: name the
laws you answer to and, for GDPR, the legal basis for each use. Sign-up
stays open to the EU and UK (D-115), so GDPR and UK GDPR probably apply.
A starting point for counsel: contract for the account, closet, runs and
kits; legitimate interests for screening, moderation, security, the
leaked-password check and the anonymous conditions numbers; consent for
browser location and Strava; legal obligation for reports to NCMEC.]

## Security

Everything travels over HTTPS, and the app tells browsers to use only
HTTPS for a year. [OWNER: confirm "Always Use HTTPS" is on for the zone;
the app's header does not cover a browser's very first visit.] Passwords
are hashed. Only the account that owns a garment photo can load it, and a
private kit returns nothing to anyone else. Cloudflare encrypts our
databases and stored files at rest. Google tokens are stored in our
database so the connection keeps working, and a Strava refresh token so we
can revoke our access; we do not encrypt them separately.

## Children

dialed.run is for people 18 and over. When you create an account we ask
for your date of birth, check it on our server, and keep neither the date
nor your age: an account existing is the record that the check passed. If
the check fails, your browser keeps a cookie for one day so the form
cannot simply be tried again with a different date.

We do not knowingly collect data from anyone under 18. If we learn that an
account belongs to someone under 18, we close it and delete its data. If
you think one does, email hello@dialed.run.

## Changes to this policy

When this policy changes we will update the date at the top. [OWNER: how
you will tell people about a material change. The code has no prompt for
policy changes. Recommended: match the terms ("in the app or by email, at
least 30 days ahead").]

## Governing law

[OWNER: governing law and jurisdiction, the same as the terms.]

## Contact

hello@dialed.run
