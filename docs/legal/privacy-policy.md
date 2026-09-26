> **DRAFT: not reviewed by a lawyer.** Written from the code on `main` as of
> 2026-09-25 for the owner to edit. Every `[OWNER: …]` note is a decision or
> a fact the code cannot supply. Every factual claim is mapped to the code
> that makes it true in `privacy-policy-sources.md`; change one, change both.

# [dialed.run] privacy policy

Effective: [OWNER: date this is published]

[dialed.run] is a log of what you wore on your runs and how it worked. This
page says what we keep, why, who else touches it, and what you can do about
it. Where something is not built yet, it says so.

## Who we are

[dialed.run] is run by [OWNER: legal entity name, or your own name if there
is no entity], [OWNER: postal address, if you publish one].

Questions about this policy or your data: [OWNER: contact email].

## The short version

- We keep your account, your closet, your runs and your kits. That is the
  product.
- Kits you share are public, and shared is the default. You can make any
  kit private, or make private your default.
- Your run's start point is never shown to anyone. It is used to look up the
  weather.
- Faces in your photos are blurred on your phone before upload, unless you
  turn that off.
- From Strava we keep your connection and an activity id per reminder. Never
  your activity data.
- No ads. No analytics. No selling or renting your data.
- You cannot yet delete your account or export your data from the app. See
  [Your choices](#your-choices).

## What we keep, and why

### Your account

- **Email address and the name you sign up with.** To sign you in and to
  tell accounts apart.
- **Your password, hashed.** We store a scrypt hash, never the password
  itself. [OWNER: pending PR #104] When you set a password we check it
  against Have I Been Pwned's list of leaked passwords. Only the first five
  characters of the password's SHA-1 hash leave our servers; the password and
  the full hash never do.
- **If you sign in with Google:** Google gives us your name, email address,
  profile picture link and Google account id. We ask for the `openid`,
  `email` and `profile` permissions only. We also store the tokens Google
  issues at sign-in.
- **Sessions.** When you sign in we record a session token, when it expires
  (7 days), the browser that signed in, and its IP address. [OWNER: the IP
  is read from the `x-forwarded-for` header; confirm in production whether
  Cloudflare populates it, and keep or drop "IP address" to match.]
- **Email.** [OWNER: pending. The app sends no email today. If email
  verification or password reset ships, name the provider here and what it
  receives.]

### Your profile

- **Display name** and **the place you run**, if you set them. Both show on
  your public profile.
- **Coordinates for that place**, if you let your browser share your
  location during setup. These are stored as your browser reports them, at
  full precision, and are never shown to anyone. They stand in for a run's
  location when a manual run has none.
- **How warm or cold you run** (your thermal level), your units, and whether
  your kits are shared by default. Your thermal level is never public.

### Your closet

Each garment you add: category, brand, model name, size, colour, and the
attributes you choose (layer, weight, fabric, wind and water resistance,
visibility), a product link if you paste one, and a photo if you take one.

### Your runs

- **Manual runs:** start time, duration, distance, title, effort, and whether
  it was indoors.
- **Imported files (GPX, FIT, TCX, up to 25 MB):** we store the file, read
  the start time, duration, distance and **the first GPS point** from it, and
  save those to the run. The run keeps only that start point, not the route.
  The file itself sits in separate storage set to delete it after 30 days.
  [OWNER: this is a lifecycle rule in the Cloudflare dashboard, not in code.
  Confirm it is set on the `dialed-imports` bucket before this sentence goes
  live.]
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
  run's start coordinates and date to **Visual Crossing**, our weather
  provider. Your name, email and account id are not sent. The answer is kept
  in a shared weather cache keyed by the location rounded to two decimal
  places (about 1 km) and the hour, alongside a reference to the run that
  first fetched it.
- **Setup.** To suggest a starter closet, the place you typed or the
  coordinates your browser shared are sent to Visual Crossing to look up
  typical winter and summer temperatures there.
- **"Your conditions" on the feed.** If you allow it, your browser sends
  your current location to our server to look up recent weather near you
  from the cache. It is not stored, and it is not sent to Visual Crossing.
- **Time zone.** A run's local time comes from the time zone Visual Crossing
  reports for the place.
- **Never shown.** No run's coordinates are shown to anyone, including on
  public kits.

## Photos

- **Faces are blurred before upload, by default.** Face detection runs in
  your browser; the model is loaded from our own site and your photo does not
  leave your device for it. Blurred areas are pixelated, not softened, so
  they cannot be recovered. You can also tap to blur anything else.
- **Blurring also strips photo metadata.** With blur on, the photo is redrawn
  in your browser, and the uploaded copy carries none of the camera's
  metadata, including any GPS location the camera wrote.
- **With blur off, the file is uploaded as it is.** We do not strip metadata
  on our servers. If your camera records location, a photo uploaded with blur
  off can carry it, and for kit photos that file is what other people
  download. [OWNER: launch gap. Either strip metadata on upload or keep this
  warning.] Turning blur off is remembered in your browser only.
- **Garment photos** are only ever shown to you. We keep the photo you
  uploaded and three resized copies.
- **Kit photos** are shown to anyone who can see the kit, once screened.
- **Screening.** Every photo is sent to **OpenAI's** moderation service to
  check for sexual, violent and self-harm content. We keep the scores it
  returns. A photo that scores high is hidden from everyone but you until a
  person reviews it. Until a photo is screened, only you can see it.
  [OWNER: confirm Cloudflare's CSAM scanning tool is enabled, then say so
  here.]

## What other people can see

**Treat a shared kit as public.** Today the pages that show kits and
profiles ask you to sign in, but a shared kit's photos can be loaded by
anyone with their address, and we may open these pages to signed-out
visitors. [OWNER: decide whether shared means "any runner on [dialed.run]"
or "anyone on the web", and say which. The data behind the kit and profile
pages is also served to signed-out requests today.]

**A shared kit** shows your display name, the run's title, date and start time, distance,
duration, whether it was indoors, its conditions, the garments you wore
(name, brand, category, layer), your verdict, caption, tags, screened photos,
and how many people marked it useful.

**Your profile** shows your display name, the place you run, and your recent
shared kits.

**Never shown to anyone else:** your email, your closet as a whole, your
garment photos, your private kits, notes and flags on garments, your thermal
level, your verdict history and coverage, and any run's coordinates.

**Sharing is on by default.** You choose shared or private for each kit when
you give the verdict, and you can make private your default in settings.
Private kits never appear in feeds or in anyone's conditions numbers.

**Conditions numbers.** Shared kits are counted, without names, in numbers
like "15 of 18 wore long sleeves" for runners in similar weather. Blocking
someone does not remove their kits from these counts, because the counts
name no one.

**Blocking** records that you blocked someone. It does not notify them.
[OWNER: launch gap. The block is stored but no feed, profile or kit page
reads it yet, so it does not hide anything today. Once it does, this line
can say "hides the two of you from each other".]

## Strava

Connecting Strava is optional. It exists for one thing: a reminder to log
your kit when you post a new run there.

- **What we keep:** your Strava athlete id, the access and refresh tokens
  Strava issues, when the token expires, and whether the connection works.
- **Permission:** we ask for `activity:read`. [OWNER: confirm this is the
  minimum scope Strava requires to send new-activity events, and say so.] We
  never use it to read an activity: our code calls Strava only to connect,
  refresh the token and disconnect.
- **When you post a run on Strava,** Strava tells us an activity id, your
  athlete id and a time. We keep the activity id, the event type and that
  time so we never remind you twice, and we create a notification that
  points at that activity id.
- **Never:** distance, pace, route, title, photos, heart rate or any other
  activity data. We do not store, show or use it.
- **Disconnecting** deletes the connection immediately. We keep the access
  token only in a queue of revocations until Strava confirms it has revoked
  our access, then delete it.
- **If you revoke us from Strava's side,** we notice the next time we try to
  refresh the token and mark the connection broken. The tokens stay stored
  until you disconnect in [dialed.run]. [OWNER: launch gap. Strava's
  deauthorization event is currently ignored.]
- Reminder notifications and the activity ids behind them are kept after you
  disconnect. [OWNER: decide whether disconnecting should delete them.]

## Product lookups

When you paste a product link, **our servers** (not your browser) fetch
that page, directly or through **Firecrawl** when the shop blocks us. We keep
a copy of the page and may send its text and address to **OpenAI** to read
the fabric and composition. Nothing about you is sent with it.

Products are a shared catalogue. A product you add, and its name as you
typed it, can be seen by other runners and reported by them. We record which
account added it.

## Moderation

- Signed-in runners can report a kit, a photo, a profile or a product name.
  When three different people report the same kit or photo, it is hidden
  from everyone but its owner and a person reviews it. A profile or product
  name reported three times goes to a person for review.
- Reviewers are a short list of admins we name in configuration. They can
  see reported and flagged content, including hidden photos, with the
  reports' reasons and notes.
- We can ban an account, which records the reason and signs it out
  everywhere. [OWNER: nothing yet stops a banned account signing back in
  or hides its content; the ban is recorded only.]
- [OWNER: say who the admins are, or "the people who run [dialed.run]".]

## Who else handles your data

We use these services to run [dialed.run]. We do not sell or rent your data
to anyone.

| Service                            | What it does for us                                                     | What it receives                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cloudflare                         | Hosts the app: servers, databases, photo and file storage, queues, logs | Everything above, stored on its platform                                                                  |
| Google                             | "Sign in with Google", if you use it                                    | The sign-in request; returns your name, email and picture                                                 |
| Strava                             | Run reminders, if you connect                                           | The connect, token-refresh and disconnect requests                                                        |
| Visual Crossing                    | Weather                                                                 | Run start coordinates and date; the place you set during setup                                            |
| OpenAI                             | Photo screening; reading product pages                                  | Your photos; the text and address of product pages                                                        |
| Firecrawl                          | Fetching product pages that block us                                    | The product link                                                                                          |
| Sentry                             | Error reports                                                           | The error and internal ids (account, run, import, product), never tokens, request bodies or file contents |
| Have I Been Pwned [OWNER: PR #104] | Leaked-password check                                                   | The first five characters of your password's SHA-1 hash                                                   |
| [OWNER: email provider, pending]   | [OWNER: pending]                                                        | [OWNER: pending]                                                                                          |

[OWNER: where Cloudflare stores the databases and buckets (region or
jurisdiction), and whether you need a transfer statement for users outside
it.]

## Cookies and browser storage

- **A session cookie** keeps you signed in, for up to 7 days.
- **Short-lived cookies during sign-in**, including one that lasts 10
  minutes while you connect Strava, stop the sign-in or connection being
  hijacked.
- **One browser setting,** saved only if you turn face blur off, so we
  remember not to load the face detector again.

No advertising or analytics cookies. No third-party scripts; our fonts and
the face-blur model are served from our own site.

## How long we keep it

| What                                                                                            | How long                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Imported run files                                                                              | 30 days [OWNER: confirm the bucket rule is set]                                 |
| Session records                                                                                 | Expire after 7 days. [OWNER: expired rows are not swept today; decide a period] |
| Strava tokens                                                                                   | Until you disconnect, then until Strava confirms revocation                     |
| Garments you delete (never used in a kit)                                                       | The record is deleted; the photo files are not. [OWNER: launch gap]             |
| Garments used in a kit                                                                          | Kept, marked retired, so old kits still make sense                              |
| Everything else: account, profile, runs, kits, photos, follows, reports, notifications, weather | [OWNER: not built. There is no deletion. Decide a period, or build deletion]    |
| Server logs                                                                                     | [OWNER: Cloudflare Workers Logs retention for your plan]                        |
| Error reports                                                                                   | [OWNER: Sentry retention for your plan]                                         |
| Product pages we fetched                                                                        | Kept, to re-read later. Not personal data                                       |

## Your choices

What you can do in the app today:

- Make any kit private, and make private your default.
- Edit your garments. Delete one you have never worn in a kit; retire one
  you have.
- Turn face blur off or on, per device, and blur anything by tapping it.
- Disconnect Strava.
- Unfollow, remove a "useful", block, unblock, and report.
- Allow or refuse location in your browser. Everything works without it; a
  run without a location gets no automatic weather.

What you cannot do in the app yet:

- **Delete your account.** [OWNER: not built]
- **Export your data.** [OWNER: not built]
- **Delete a run, a kit, or a kit photo.** [OWNER: not built]
- **Change your email address or reset a forgotten password.** [OWNER: not
  built; depends on email sending]

Until these exist, email [OWNER: contact email] and we will do it by hand
within [OWNER: days]. [OWNER: confirm you will honour access, correction and
deletion requests by hand, and name the laws you are answering to (GDPR, UK
GDPR, CCPA/CPRA, or none), with the legal bases for processing if GDPR
applies.]

## Security

Everything travels over HTTPS. [OWNER: confirm "Always Use HTTPS" is on
for the zone; the code does not enforce it.] Passwords are hashed. Only the account that
owns a garment photo can load it, and a private kit returns nothing to
anyone else. Strava and Google tokens are stored in our database so the
connection keeps working; they are not separately encrypted by us.
[OWNER: confirm Cloudflare's encryption at rest for D1 and R2 before
claiming it.]

## Children

[OWNER: minimum age. The app does not ask for or check age today. Common
choices are 13 (US, COPPA) or 16 (parts of the EU). Say what happens if you
learn an account belongs to someone under it.]

## Changes to this policy

When this policy changes we will update the date at the top. [OWNER: how
you will tell people about a material change, e.g. a notification in the
app.]

## Governing law

[OWNER: jurisdiction and governing law.]

## Contact

[OWNER: contact email]
