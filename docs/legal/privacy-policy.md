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
> 2026-10-11, revised 2026-10-18 from the pre-launch legal review (rev. 2)
> and decisions D-125 to D-139, and 2026-10-28 for public kits and
> profiles (D-150 to D-153), for the owner to edit. Every `[OWNER: …]` note is a decision or
> a fact the code cannot supply. Every factual claim is mapped to the code
> that makes it true in `privacy-policy-sources.md`; change one, change both.

# [dialed.run] privacy policy

Effective: [OWNER: the day the first invite is sent]

[dialed.run] is a log of what you wore on your runs and how it worked. This
page says what we keep, why, who else touches it, and what you can do about
it. Where something is not built yet, it says so.

## Who we are

[dialed.run] is run by Big Long Run Labs LLC, a Nebraska limited liability
company ("we"), which decides how your data is used (the "controller").
Postal address: [OWNER: the LLC's registered address (D-126), filled in at
publication].

Questions about this policy or your data: hello@dialed.run.

## The short version

- We keep your account, your closet, your runs and your kits. That is the
  product.
- Kits you share are seen by other signed-in runners, and shared is the
  default. You can make any kit private, or make private your default.
- Nothing is shown to people who are not signed in unless you make it
  public: a kit you mark public, and your profile if you turn it on, can
  be seen by anyone with the link. See
  [What other people can see](#what-other-people-can-see).
- Your runs, shared and private, count without your name in public totals
  like the guides, and only where at least 5 runners are behind a figure.
  You can turn that off in Settings. See
  [Anonymous totals](#anonymous-totals).
- Locations are kept to about a kilometre, and no run's location is shown
  to other runners or the public (see [Our access to your content](#our-access-to-your-content)). We do not keep your
  route.
- Faces in your photos are blurred on your phone before upload, unless you
  turn that off. Every photo is re-encoded on our servers, so none keeps
  the camera's metadata.
- From Strava we keep your athlete id, one token used only to revoke our
  access, and, for no more than 7 days, the id of each new activity so we
  remind you once. Never your activity data.
- The app runs no analytics; the marketing site counts page views without
  cookies (see [Cookies](#cookies-and-browser-storage)).
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
  you leave, and whether we invited you or declined. If Cloudflare places
  your connection in Mississippi or Tennessee, we also note that state,
  because we cannot open sign-up there yet (see the [terms](/terms)).
  Signing up makes the same check and keeps nothing. We delete it 90 days after we
  answer; a request we have not answered yet is kept until we do.
- **Your password, hashed.** We store a scrypt hash, never the password
  itself. When you set a password we check it against Have I Been Pwned's
  list of leaked passwords. Only the first five characters of the
  password's SHA-1 hash leave our servers; the password and the full hash
  never do. If that check cannot answer, your password is accepted.
- **If you sign in with Google:** Google gives us your name, email address,
  profile picture link and Google account id. We keep the email address,
  the picture link and the account id; we do not keep your name. We ask
  for the `openid`, `email` and `profile` permissions only. We do not keep
  the tokens Google issues at sign-in.
- **Sessions.** When you sign in we record a session token, when it expires
  (7 days), the browser that signed in, and its IP address (as Cloudflare
  reports it). The record is deleted 30 days after the session expires,
  except as kept with
  [suspected child sexual abuse material](#moderation).
- **Counts that stop abuse.** We count sign-in and sign-up attempts per IP
  address; those counts are kept for about a minute and then deleted. We
  count how many confirmation links, password resets and email changes each
  address asked for in the last hour, and how many wrong passwords you
  typed when changing your email or password. Requests for access and
  removal requests are counted per visitor IP address the same way. Each
  of these counts is deleted a day after its window ends.
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
  your profile to other signed-in runners. If you turn on your public
  profile, your username shows on it too; the place you run does not.
- **Username screening.** When you pick a username we check it against a
  list of offensive words and send it, alone, to **OpenAI's** moderation
  service. Nothing else about you goes with it.
- **Usernames you have used.** When you change your username, or delete
  your account, the old one is kept for good so nobody else can take it.
- **Coordinates for that place**, if you let your browser share your
  location, rounded to two decimal places (about a kilometre) before they
  are stored, and the time zone that place is in, which we use to time
  your emails and to tell when your day starts. The coordinates are never
  shown to other runners or the public (see [Our access to your content](#our-access-to-your-content)). They stand in
  for a run's location when a manual run has none.
- **How warm or cold you run** (your thermal level), your units, who sees
  your new kits by default, whether your profile and your closet are
  public, and which emails you have switched off.
  Your thermal level is never shown to other runners.
- **Whether your runs count in anonymous totals**, on unless you turn it
  off (see [Anonymous totals](#anonymous-totals)).

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
notes and flags on individual garments. Notes and flags on garments are
never shown to other runners.

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
  that rounded location and the hour; it is not linked to you or to your
  run. A temperature you set yourself for a run is kept with that run and
  deleted with it.
- **Setup.** To suggest a starter closet, the place you typed or your
  rounded coordinates are sent to Visual Crossing to look up typical
  winter and summer temperatures there.
- **The place you run.** When you save it, its rounded coordinates are sent
  to Visual Crossing once, to find its time zone. If that fails, we try
  again each hour until a time zone is found. The answer is kept in the
  same shared weather cache, keyed by that rounded location.
- **"Your conditions" on the feed.** If you allow it, your browser sends
  your current location to our server to look up recent weather near you
  from the cache. It is not stored, and it is not sent to Visual Crossing,
  unless you choose to save it as the place you run, when it is rounded,
  stored and sent as above.
- **Time zone.** A run's local time comes from the time zone Visual Crossing
  reports for the place.
- **Never shown.** No run's coordinates are shown to other runners or the
  public, including on shared and public kits (see [Our access to your content](#our-access-to-your-content)).

## Photos

- **Faces are blurred before upload, by default.** Face detection runs in
  your browser; the model is loaded from our own site and your photo does not
  leave your device for it. Blurred areas are pixelated, not softened, so
  they cannot be recovered. You can also tap to blur anything else.
  Turning blur off is remembered in your browser only.
- **No photo keeps its metadata.** Every photo, kit or garment, blur on or
  off, is decoded and saved again as a new JPEG on our servers, so nothing
  the camera wrote, including any GPS location, is kept or shown.
- **Garment photos** are never shown to other runners. We keep the photo you
  uploaded, re-encoded, and three resized copies.
- **Kit photos** are shown to signed-in runners who can see the kit, once
  screened.
- **Photos on public kits** are shown to anyone who opens the kit, once
  screened. While the kit is public, a copy of each is kept in a separate
  public store under an address nobody can guess, and served from
  Cloudflare's network. The copy is deleted when the kit stops being
  public, when the kit or photo is hidden or removed, or when you are
  banned or leave. Cloudflare checks photos served from that store against
  lists of known child sexual abuse material; a match is blocked, and we
  remove it and report it as the law requires.
- **Screening.** Every photo is sent to **OpenAI's** moderation service to
  check for sexual, violent and self-harm content. We keep the scores it
  returns until the photo is deleted. A photo that scores high, kit or
  garment, is hidden from everyone but you until a person reviews it.
  Until a photo is screened, no one but you can see it.
  OpenAI keeps nothing it is sent for screening, and does not use it to
  train its models.
- **Fingerprints.** For every photo, we work out a fingerprint from the
  photo as you uploaded it: a 16-character code describing its broad
  pattern of light and dark, from which the photo cannot be rebuilt. It is
  kept with the photo and deleted with it. We use it only to find copies
  of a photo that was reported or that someone asked us to remove, across
  every runner's photos, private ones included. One exception: when we
  remove a photo as an intimate image shared without consent, we keep its
  fingerprint for 3 years, so that if the same image is uploaded again it
  is hidden until a person reviews it.

## What other people can see

**Signed-in runners, unless you choose public.** "Shared" means other
signed-in runners on [dialed.run], not the open web. Shared kits, profiles
and their photos are not shown to anyone who is not signed in. A link to a
shared kit posted elsewhere previews as a generic [dialed.run] card, with
nothing from the kit on it. Only what you make public, below, reaches the
open web.

**A shared kit** shows your username, the run's title, date and start time, distance,
duration, whether it was indoors, its conditions, the garments you wore
(name, brand, category, layer), your verdict, caption, tags, screened photos,
and how many people marked it useful.

**Your profile** shows other signed-in runners your username, the place you
run, and your recent shared and public kits.

**A public kit** can be opened by anyone who has its link, signed in or
not. It shows your username, the day of the run (never its start time or
place), distance, time, pace, elevation gain, the feels-like temperature
and sky, your verdict, caption, the garments you wore (name and type, with
a link to the product where there is one) and its screened photos. A link
to it posted elsewhere previews as a picture card with your username, the
day, the conditions, your verdict, the distance, time, pace and elevation gain, and the models
you wore, beside the first 120 characters of your caption. The card never
has a photo. Signed-in runners see a
public kit as they see a shared one, and it counts in feeds and conditions
numbers the same way.

**Your public profile** is off until you turn it on in Settings ›
Privacy. While it is on, anyone can open it at your username's address. It
shows your username and your public kits, newest first. Its "Show my
closet" switch, also off until you turn it on, adds your rotation: the name
and type of each garment, retired ones included, and for shoes the
distance logged in them, which counts your private runs too.

**Public pages ask search engines not to index them**, but anyone who has
a link can pass it on, and anyone who saw a public page may have kept a
copy.

**Taking it back.** Make a public kit shared or private, or turn your
public profile or closet off, and it stops being public straight away;
Cloudflare's network may keep serving a copy it already holds for up to a
minute. A kit that is hidden or removed by moderation, and everything of
yours when you are banned or leave, stops being public the same way.
Turning your public profile off does not change kits you already made
public: each stays public until you change it.

A preview card that another site or app already fetched is that site's
copy; we cannot recall it, though the link itself stops previewing the
kit within the same minute. Beyond the minute above, the steps we take
are these: public pages ask search engines not to index them, and we
clear our own copies when something stops being public.

**Never shown to other runners or the public:** your email, your closet
(except your rotation, if you show it on your public profile), your
garment photos, your private kits, notes and flags on garments, your
thermal level, your verdict history and coverage, and any run's
coordinates. The people who run [dialed.run] can see them only for the
reasons under
[Our access to your content](#our-access-to-your-content).

**Sharing is on by default.** You choose shared, private or public for
each kit when you give the verdict, and you can make private your default
in settings. Public can be your default only while your public profile is
on; turning the profile off makes shared your default again. Until you
confirm your email address, the kits you log are saved private, and none
can be made public; your public profile is not shown until then
either.
Private kits never appear in feeds or in anyone's conditions numbers. They
do count, without your name, in anonymous totals unless you turn that off
(see [Anonymous totals](#anonymous-totals)).

**Conditions numbers.** Shared kits are counted, without names, in numbers
like "15 of 18 wore long sleeves" for runners in similar weather, unless
their runner has turned off "Count my runs in anonymous totals" (see
[Anonymous totals](#anonymous-totals)). Blocking
someone does not remove their kits from these counts, because the counts
name no one.

**Blocking** hides the two of you from each other: each other's kits in
feeds and on kit pages, each other's profiles, and each other in search.
It does not notify them. It cannot hide your public kits or public profile
from anyone who opens their public addresses, whether or not they are
signed in.

## Our access to your content

"Private" means not shown to other runners or to the public. The people
who run [dialed.run] can see any content in it, private kits, garment
photos and notes included, when they need to for one of these reasons:

- **Running and securing the service:** fixing faults, keeping it working
  and stopping abuse.
- **Reports, removal requests and moderation,** including looking through
  a runner's other photos, private ones included, for copies of an image
  that was reported, and searching every runner's photos, private ones
  included, by their [fingerprints](#photos) for copies of it.
- **Meeting legal obligations,** and answering lawful requests from the
  authorities.
- **Support you ask for,** when you write to us about your account.

We do not otherwise look at your private content. Apart from the services
listed under [Who else handles your data](#who-else-handles-your-data),
which handle it on our behalf (for example, every photo is sent to OpenAI
for screening), only the people who run [dialed.run] have this access.

## Anonymous totals

We publish, or may publish, guides and reports, such as what runners wear
at a given feels-like temperature, made by adding up a few details of many
runners' runs. **Private runs are counted too.** Private means no other
runner can see the run, not that it is never counted. You can turn this off.

- **What is counted:** for each run, the feels-like temperature band, the
  sky, the month, the broad climate zone the run was in, worked out from
  its location and never anything more precise, the type and catalogue
  model of each garment you wore, and your verdict. Totals may also group
  runners by the conditions they usually run in, worked out from their own
  counted runs. A garment in your closet counts only when you wore it on a
  counted run.
- **What is never counted:** your name, username or email, your notes,
  captions, photos or route, when your run started, its start point or any
  place more precise than its climate zone, or anything else you typed. Totals are made from the fields above alone.
- **Who is counted:** only accounts with a confirmed email address. Left
  out: kits we removed or quarantined, accounts we closed, accounts being
  deleted, and runs whose conditions you set yourself because no weather
  was found.
- **When a figure is published:** only when at least 5 different runners
  are behind it, or 20 if it is about a brand. That holds for every row and
  every slice, including a climate zone or a group of runners. A figure
  below the line is left out, not shown as "fewer than 5". Where leaving one
  figure out would let it be worked out by subtracting others, another is
  left out too, and published counts are rounded to the nearest 5, so no
  total can point to one runner.
- **How often:** guides are rebuilt no more than once a month.
- **Anyone may reuse them.** We publish totals under the Creative Commons
  Attribution 4.0 licence (CC BY 4.0), so others may copy and reuse them
  with credit to [dialed.run]. A total names no one, whoever reuses it.
- **Climate zones, not places.** A run's location is used only to work out
  which broad climate zone (a Köppen-Geiger zone) it was in, when the totals
  are made. Nothing new is stored with your run, and no place more precise
  than the zone is counted. A guide about a state, such as "runners in
  climates like Minnesota's", is made by matching the state to the climate
  zones it contains, and uses no runner's data to do it.
- **Turning it off:** in Settings › Privacy, "Count my runs in anonymous
  totals" is on by default. Turn it off and your runs leave the guides the
  next time we rebuild them, within a month, and are left out of any report
  made after that.
  Reports already published stay as they are; they name no one, so your
  runs cannot be taken out of them. Turning it off also takes your shared
  kits out of the conditions numbers other runners see in the app; you
  still see those numbers yourself. Turning it back on counts your runs
  again. Deleting your account turns it off too.
- **The numbers in the app.** Conditions numbers and counts like "worn by
  N runners" in the app come from shared kits only, never private ones.
- **Why we may do this.** Where the GDPR or UK GDPR applies, the legal
  basis is our legitimate interest in guides that reflect every run, not
  only the ones people chose to share. We have weighed that against your
  interests: only the fields above are counted, no figure stands for fewer
  than 5 runners (20 for a brand), counts are rounded and cells that could
  be worked out are left out, no total holds your name or anything
  else that identifies you, only confirmed accounts count, and you can
  object at any time by turning the setting off.

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
  stays, with no Strava data in it. If a reminder fails every retry, the
  record of that failure keeps no Strava id after 7 days, or after you
  disconnect or delete your account.
- **Never:** distance, pace, route, title, photos, heart rate or any other
  activity data. We do not store, show or use it.
- **Disconnecting** deletes the connection immediately, and we email you to
  confirm it. We keep the refresh
  token only in a queue of revocations until Strava confirms it has revoked
  our access, then delete it.
- **If you revoke us from Strava's side,** Strava tells us, and we delete
  the connection straight away, revoke with the refresh token in the same
  way, and tell you that reminders have stopped.
- **Strava's role.** Strava decides for itself how it handles your Strava
  data; for that it is a separate controller under its own privacy policy,
  not our processor. Strava may also collect and use data about how our app
  uses its API, for its own business purposes.

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
  owner and a person reviews it, and we tell its owner in the app that it
  is hidden. A profile or product name reported three times goes to a
  person for review.
- **When a person decides on a report,** we tell each runner who filed it,
  in the app, whether we removed what they reported or left it up. If
  reports hid a kit or photo and we leave it up, we tell its owner. The
  notice does not name who reported it.
- One report that a kit or photo is an intimate image shared without
  consent hides it from everyone but its owner at once, tells its owner in
  the app, and emails each reviewer that it is waiting and when its 48 hours run out. The email
  says what kind of thing was reported and when; it does not name you or
  the runner who posted it.
- **A removal request** made at [/takedown](/takedown), with or without an
  account: we keep the email address, the name typed as a signature, the
  link or description of where the image is, the username of whoever
  posted it if you give one, anything written about it,
  when it was made, and what we decided, with the reason if we declined.
  If the link points to a kit or photo on [dialed.run], we hide it from
  everyone but its owner while we look, except under the limits below,
  tell its owner in the app that it is hidden, and put it back if we
  decline. We email the address a receipt and the decision, and email each
  reviewer that a request is waiting. We count requests per visitor IP
  address, as we do requests for access, to stop the form being flooded,
  and delete each count a day after its hour ends. To stop one person
  filing many requests, we keep with each request a
  form of the email address that ignores dots and "+" tags where the
  provider does, and a one-way keyed code made from the IP address (not
  the address itself). Someone who already has two requests open must
  confirm a third from the link in its receipt before it hides anything,
  and while ten requests in the past hour have hidden something, new ones
  hide nothing (a person still reviews them). If someone abuses the form, we may
  block that email and code from it: their requests are still recorded
  and they still get a receipt, but nothing is hidden. We keep a request for 3 years after we decide it, because
  it is the record of why something was or was not removed.
- Reviewers are the people who run [dialed.run], named in our
  configuration; today that is one person. They can see reported and
  flagged content, including hidden photos, with the reports' reasons and
  notes.
- **When we remove a kit or photo,** we delete it and its files, except
  that material removed after a copyright notice is hidden for 30 days
  first, so a counter-notice can restore it. We keep a record of what was
  removed, by whom and why, for 3 years, and tell its owner in the app and by email. A
  moderator can also change a username that breaks the rules, and the
  runner is told why the next time they open the app.
- **Suspected child sexual abuse material** is the exception: it is
  removed at once, and its owner is not told. We report it to the National
  Center for Missing & Exploited Children and keep a locked copy that only
  reviewers can see, with who uploaded it and when, for one year after the
  report, then delete it unless the law or law enforcement requires us to
  keep it longer. With it we keep, for the same time, the uploader's email
  address, username and session records (each sign-in's times, browser and
  IP address) as they stood when we removed it, even if the account is
  later closed or deleted, because US law asks us to preserve them with the
  report. This applies to garment photos as well as kits.
- **We can close an account.** We record the reason, sign it out
  everywhere, refuse it sign-in, hide its kits, photos and profile from
  everyone else, and email the reason and the rule it broke. Reopening it
  brings them back.

## Who else handles your data

We use these services to run [dialed.run]. Most handle data only on our
behalf (they are our "processors"). Google and Strava are different: when
you choose to sign in with Google or connect Strava, each is also a separate
controller of what it holds about you, under its own privacy policy. We do
not sell or rent your data to anyone.

| Service                           | Company                         | Role                      | What it does for us                                                                                                 | What it receives                                                                                           | Where                    | Safeguard for EU and UK data                                                                                            |
| --------------------------------- | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Cloudflare                        | Cloudflare, Inc.                | Processor                 | Hosts the app: servers, databases, photo and file storage, queues, logs; serves and scans the photos on public kits | Everything above, stored on its platform                                                                   | North America            | EU-U.S. Data Privacy Framework and its UK and Swiss extensions; standard contractual clauses in its DPA as the fallback |
| Cloudflare Email Service          | Cloudflare, Inc.                | Processor                 | Sends our email                                                                                                     | Each email's address, subject and body                                                                     | North America            | EU-U.S. Data Privacy Framework and its UK and Swiss extensions; standard contractual clauses in its DPA as the fallback |
| Cloudflare Turnstile              | Cloudflare, Inc.                | Processor                 | Tells people from bots on sign-up, request access and removal requests                                              | The check your browser runs, and your IP address from our server                                           | Worldwide                | EU-U.S. Data Privacy Framework and its UK and Swiss extensions; standard contractual clauses in its DPA as the fallback |
| Google                            | Google LLC                      | Separate controller       | "Sign in with Google", if you use it                                                                                | The sign-in request; Google returns your name, email, picture and account id                               | US                       | Google's own Data Privacy Framework certification                                                                       |
| Strava                            | Strava, Inc.                    | Separate controller       | Run reminders, if you connect                                                                                       | The connect and revoke requests                                                                            | US                       | Standard contractual clauses under Strava's API terms                                                                   |
| Visual Crossing                   | Visual Crossing Corporation     | Service provider          | Weather, and time zones for places                                                                                  | Rounded run start points and dates; the place you set. Nothing that names you                              | US                       | None needed: nothing that names you is sent                                                                             |
| OpenAI                            | OpenAI OpCo, LLC                | Processor                 | Photo screening; username screening; reading product pages                                                          | Your photos; the username you pick; the text and address of product pages                                  | US                       | Standard contractual clauses with the UK addendum, in OpenAI's data processing addendum                                 |
| Firecrawl                         | SideGuide Technologies, Inc.    | Service provider          | Fetching product pages that block us                                                                                | The product link. Nothing that names you                                                                   | US                       | None needed: nothing that names you is sent                                                                             |
| Sentry                            | Functional Software, Inc.       | Processor                 | Error reports                                                                                                       | The error and internal ids (account, run, import, product), never tokens, request bodies or file contents  | US                       | EU-U.S. Data Privacy Framework and its UK and Swiss extensions; standard contractual clauses as the fallback            |
| Have I Been Pwned                 | Superlative Enterprises Pty Ltd | Receives no personal data | Leaked-password check                                                                                               | The first five characters of your password's SHA-1 hash, from our server, with nothing that identifies you | Australia                | None needed: what it receives is not personal data                                                                      |
| GoatCounter (marketing site only) | Martin Tournoij (Ireland)       | Processor                 | Counts page views on dialed.run                                                                                     | Your IP address and browser, held in memory for up to 8 hours and not stored                               | Finland and Germany (EU) | None needed: no transfer out of the EU                                                                                  |

We are in the United States, and your data is stored in North America. To
keep the app fast wherever you open it, Cloudflare also keeps read-only
copies of our databases in its data centres in Europe, Asia-Pacific and
Oceania. Your photos and files are not copied; they stay in North America.
The app itself runs on Cloudflare's network, so a request may be handled in
the Cloudflare data centre nearest you before it reaches our storage.

If you are in the European Economic Area, the United Kingdom or
Switzerland, your data is transferred to the United States and to those
other regions. Where a service is certified under the EU-U.S. Data Privacy
Framework (and its UK and Swiss extensions), we rely on that certification;
otherwise we rely on the European Commission's standard contractual
clauses, with the UK addendum, included in that service's data processing
terms. Cloudflare's terms apply wherever it holds the data. Google and
Strava act for themselves when you sign in with Google or connect Strava,
under their own privacy policies. Visual Crossing, Firecrawl and Have I
Been Pwned receive nothing that names you: rounded places and dates,
product links, and five characters of a password hash. You can ask us for a
copy of the safeguards at hello@dialed.run.

## Cookies and browser storage

- **A session cookie** keeps you signed in, for up to 7 days.
- **Short-lived cookies during sign-in**, including one that lasts 10
  minutes while you connect Strava, stop the sign-in or connection being
  hijacked.
- **An age-check cookie**, only if sign-up refused a date of birth as
  under 18, for one day (see [Children](#children)).
- **A database position cookie**, for one day, so the next page you open
  shows at least what you last saw or saved. It holds a position in our
  database's history, not anything about you.
- **In your browser's storage:** whether you turned face blur off, so we
  do not load the face detector again; your account id, so a tab knows
  when you have signed in as someone else; and, for one tab and only
  until you close it, your email address if you were signed out mid-form,
  so the sign-in form can fill it in.

No advertising or analytics cookies. Our fonts and the face-blur model are
served from our own site. The one third-party script is Cloudflare
Turnstile's, loaded only on sign-up, request access and the removal
request form; Cloudflare's Turnstile Privacy Addendum explains what it
collects and how Cloudflare uses it.

dialed.run (the marketing site) counts page views with GoatCounter, which
sets no cookies and stores nothing in your browser. It is hosted in the
European Union, keeps aggregate page counts only, and does not store your
IP address.

We do not track you across other websites, and no one else tracks you
through [dialed.run]. Because there is nothing of that kind to switch off,
we do not treat browsers' "Do Not Track" or Global Privacy Control signals
any differently.

## How long we keep it

| What                                                                          | How long                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Imported run files                                                            | Until it has been read, usually within a day. A file we could not read: 30 days after the import failed                           |
| Anonymous totals                                                              | A published report stays as published; it names no one. A guide is remade from current data each time we update it                |
| Your data export                                                              | The file: 7 days from when it is ready. The record that you asked for one: deleted with the file, or 7 days after a failed export |
| Removal requests (`/takedown`)                                                | 3 years after we decide them                                                                                                      |
| Requests for access                                                           | 90 days after we answer them                                                                                                      |
| Session records                                                               | Expire after 7 days, and are deleted 30 days after they expire. A copy kept with suspected child sexual abuse material: as below  |
| Strava refresh token                                                          | Until you disconnect, then until Strava confirms revocation                                                                       |
| Strava activity ids                                                           | 7 days                                                                                                                            |
| Garments you delete                                                           | Deleted with their photo files. A garment you wore leaves those kits                                                              |
| Runs, kits and kit photos you delete                                          | Deleted with their files                                                                                                          |
| Photo fingerprints                                                            | Deleted with the photo. A locked copy of suspected child sexual abuse material keeps its own, as long as the copy                 |
| Photo screening scores                                                        | Deleted with the photo. A locked copy of suspected child sexual abuse material keeps its own, as long as the copy                 |
| Fingerprints of photos we removed as intimate images shared without consent   | 3 years after the removal, then deleted                                                                                           |
| Your account, when you delete it                                              | Hidden at once; everything below deleted 7 days later (see [Your choices](#your-choices))                                         |
| Suspected child sexual abuse material we removed, and its uploader's details  | One year after we report it to NCMEC, then deleted, unless the law or law enforcement requires longer                             |
| Usernames you have used                                                       | For good, so nobody else can take them                                                                                            |
| Copies of photos on public kits, in the public store                          | While the kit is public; deleted when it stops being public, is hidden or removed, or you are banned or leave                     |
| Copies of public pages and photos at Cloudflare's edge                        | Up to a minute after they stop being public                                                                                       |
| Weather                                                                       | Kept in the shared cache, linked to no one                                                                                        |
| Reports you filed                                                             | 3 years after the decision on what you reported, or after filing if none was needed. Kept without your name if you leave          |
| Records of moderation decisions                                               | 3 years after the decision, even after the account it concerns is deleted, and while the material is still hidden or quarantined  |
| Everything else: account, profile, runs, kits, photos, follows, notifications | Until you delete it or your account                                                                                               |
| Server logs                                                                   | 7 days                                                                                                                            |
| Error reports                                                                 | 30 days                                                                                                                           |
| Product pages we fetched                                                      | Kept, to re-read later. They hold the retailer's page, not information about you                                                  |

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
- Stop your runs counting in anonymous totals.
- Turn face blur off or on, per device, and blur anything by tapping it.
- Disconnect Strava.
- Unfollow, remove a "useful", block, unblock, and report.
- Allow or refuse location in your browser. Everything works without it; a
  run without a location gets no automatic weather.

For anything else, such as correcting something you cannot edit, or a
question about what we hold, email hello@dialed.run and we will answer
within 30 days.

## Your rights

Wherever you live, you can ask us for a copy of your data, to correct it, or
to delete it, and you can do most of this yourself in Settings. If the GDPR
or UK GDPR applies to you, you also have the right to restrict how we use
your data, to receive it in a portable form (the export above), to object to
uses based on our legitimate interests (for anonymous totals, the Settings
switch does this at once), and to withdraw consent at any time where we rely
on it, without affecting what we did before. You can complain to the data
protection authority where you live or work. We will answer any request
within one month.

You need an email address and a password, or a Google account, to have an
account; everything else is optional. No decision with legal or similarly
significant effects on you is made by automated means alone: automated
screening can hold a photo back until a person looks at it, and nothing
more.

## Why we use your data (legal bases)

Where the GDPR or UK GDPR applies, these are our legal bases:

| What                                                                                                                                           | Legal basis                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Your account, profile, closet, runs, kits, photos, weather lookups, the feed, follows, "useful" marks, blocks, notifications and account email | Performing our agreement with you (the terms)                                                                                                   |
| Showing your shared kits to other signed-in runners, and your public kits and public profile to anyone                                         | Performing our agreement with you; you choose shared, private or public for every kit, and turn your public profile on yourself                 |
| Screening photos and usernames, photo fingerprints, reports, moderation, removal requests, bans and records of them                            | Our legitimate interest in keeping [dialed.run] safe and lawful                                                                                 |
| Sessions, sign-in protection, counts that stop abuse, Turnstile, the leaked-password check, error reports and server logs                      | Our legitimate interest in keeping accounts and the service secure                                                                              |
| Conditions numbers in the app, and anonymous totals                                                                                            | Our legitimate interest in useful guides and numbers; you can object with the Settings switch                                                   |
| Keeping past usernames                                                                                                                         | Our legitimate interest in stopping impersonation                                                                                               |
| Reporting suspected child sexual abuse material to NCMEC, and answering lawful requests from authorities                                       | Our legitimate interest in protecting children and meeting the US law that applies to us                                                        |
| Your browser's location                                                                                                                        | Your consent, given in your browser; you can withdraw it there                                                                                  |
| Strava reminders                                                                                                                               | Your consent, given when you connect; you withdraw it by disconnecting                                                                          |
| Run reminder emails                                                                                                                            | Our legitimate interest in reminding you to log; you can switch them off at any time                                                            |
| Checking your age when you sign up                                                                                                             | Our legitimate interest in keeping [dialed.run] to adults, as the terms and US state law require                                                |
| Requests for an invite                                                                                                                         | Steps you ask us to take before an agreement with you                                                                                           |
| Product lookups and the shared catalogue                                                                                                       | Performing our agreement with you (the terms)                                                                                                   |
| Exporting your data and deleting your account                                                                                                  | Meeting our legal obligations under the GDPR or UK GDPR                                                                                         |
| Email you send us: questions, appeals, reports, copyright notices and counter-notices, and requests about your data                            | Our legitimate interest in answering you and keeping [dialed.run] safe and lawful; for a request about your data, meeting our legal obligations |
| Counting page views on dialed.run (GoatCounter)                                                                                                | Our legitimate interest in knowing which pages people read                                                                                      |

## Security

Everything travels over HTTPS, and the app tells browsers to use only
HTTPS for a year. A plain `http://` address is always redirected to
HTTPS. Passwords
are hashed. Only the account that owns a garment photo can load it in the
app, and a private kit returns nothing to other runners. The people who run
[dialed.run] reach either only for the reasons under
[Our access to your content](#our-access-to-your-content). Cloudflare encrypts our
databases and stored files at rest. A Strava refresh token is stored in our
database so we can revoke our access; we do not encrypt it separately.

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

When this policy changes we will update the date at the top. Before a
change that matters takes effect, we will tell you in the app or by email,
at least 30 days ahead, unless the change is required by law.

## Laws we follow

We handle your data under the laws of the United States and of Nebraska,
where we are, and, where they apply to you, the EU and UK GDPR and the
privacy laws of the US state where you live.

## Contact

hello@dialed.run, or by post to [OWNER: the LLC's registered address
(D-126), filled in at publication].
