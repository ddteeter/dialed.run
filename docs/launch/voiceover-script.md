# VoiceOver script (iPhone, Safari)

The step-by-step version of `voiceover-checklist.md`, for someone who has
never used VoiceOver (#365). The checklist says what must hold; this says
what to do with your fingers, what you should hear, and what to write down.
The owner runs it on their own iPhone against the first deployed build,
before friends get access, and again before public launch.

Allow about ninety minutes the first time, twenty of them for part 1.

Contents:

1. [VoiceOver from nothing](#1-voiceover-from-nothing)
2. [How to read "you should hear"](#2-how-to-read-you-should-hear)
3. [What counts as a failure](#3-what-counts-as-a-failure)
4. [The flows](#4-the-flows)
5. [Logging the run](#5-logging-the-run)

## What you need

- Your iPhone on the current iOS, with Safari. Headphones help.
- The deployed build's address, an invite code from the Desk, and an email
  address that has no account yet.
- One run file (GPX, TCX or FIT) saved in the Files app on the phone.
- A second account, made beforehand on a computer, with one Shared run.
  Flow 4 needs someone to find and follow.
- Somewhere to write: a note on a computer, or paper. Not the phone.

## 1. VoiceOver from nothing

VoiceOver reads the screen aloud and replaces the touch gestures you know.
A tap no longer presses things. The gestures below were checked against
Apple's iPhone User Guide on 2026-11-10:
[Turn on and practice VoiceOver](https://support.apple.com/guide/iphone/turn-on-and-practice-voiceover-iph3e2e415f/ios),
[Use VoiceOver gestures](https://support.apple.com/guide/iphone/learn-voiceover-gestures-iph3e2e2281/ios),
[Operate iPhone when VoiceOver is on](https://support.apple.com/guide/iphone/operate-iphone-when-voiceover-is-on-iph3e2e2329/ios)
and
[Control VoiceOver using the rotor](https://support.apple.com/guide/iphone/control-voiceover-using-the-rotor-iph3e2e3a6d/ios).

### 1.1 Set up a way out first

Do this **before** turning VoiceOver on, with your normal gestures.

1. Settings › Accessibility › Accessibility Shortcut › tick **VoiceOver**.
   Now three quick presses of the side button turn VoiceOver on and off,
   whatever the screen is doing. This is your exit.
2. Asking Siri to "turn off VoiceOver" also works.

### 1.2 Settings to change once

Settings › Accessibility › VoiceOver:

- **Speaking Rate:** drag the slider down to a speed you can follow.
- **Caption Panel:** on. What VoiceOver says is also shown as text at the
  bottom of the screen, so you can copy a failure down word for word.
- **Rotor:** tick Headings, Landmarks, Form Controls, Links and Buttons.
- **VoiceOver Practice** (shown once VoiceOver is on): a safe area where
  gestures are named and nothing is pressed. Spend five minutes here.

### 1.3 The gestures this script uses

| To do this                                  | Gesture                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Hear what is under your finger              | Tap it, or drag one finger around                                               |
| Move to the next item                       | Swipe right with one finger, anywhere                                           |
| Move to the previous item                   | Swipe left                                                                      |
| Press the item you are on ("activate")      | Double tap, anywhere                                                            |
| Jump to the first item on the screen        | Four-finger tap near the top                                                    |
| Jump to the last item                       | Four-finger tap near the bottom                                                 |
| Read the whole screen from the top          | Two-finger swipe up                                                             |
| Read on from where you are                  | Two-finger swipe down                                                           |
| Pause or resume speech                      | Two-finger tap                                                                  |
| Scroll down a page                          | Three-finger swipe up                                                           |
| Scroll up a page                            | Three-finger swipe down                                                         |
| Close a sheet or dialog, or go back         | Two-finger scrub: two fingers back and forth three times, quickly, like a "z"   |
| Choose what the rotor moves by              | Rotate two fingers on the screen, as if turning a dial, until you hear the name |
| Move by the rotor's setting                 | Swipe down for the next one, up for the previous one                            |
| Move a slider                               | Select it, then swipe up or down                                                |
| Screen Curtain on or off (the screen black) | Three-finger triple tap (four taps if Zoom is also on)                          |
| Go to the Home Screen                       | Drag one finger up from the bottom edge until you feel a vibration, then lift   |
| Turn VoiceOver off                          | Three presses of the side button (1.1)                                          |

The two that matter most: **swipe right to move, double tap to press.**
You never need to aim. A swipe moves the cursor one item, wherever your
finger lands.

### 1.4 Typing

Move to a text field and double tap. The keyboard opens. Touch a key to
hear it, then double tap to type it, or keep one finger on the key and tap
with another. It is slow; that is normal. Apple's guide has faster ways.
Pasting the invite code and email from Notes saves time and tests nothing
less.

### 1.5 The rotor, in one minute

The rotor is a dial you turn with two fingers. Each turn names a kind of
thing: "Headings", "Links", "Form Controls", "Landmarks". Stop on one, and
a one-finger swipe **down** jumps to the next thing of that kind, **up** to
the previous. Set it to Headings and swipe down repeatedly to hear a
screen's outline.

### 1.6 Screen Curtain

Three-finger triple tap turns the display black while everything still
works. Flow 2's last step is done this way: if you cannot log a run
without seeing the screen, a VoiceOver user cannot either. Leave it off
until then.

## 2. How to read "you should hear"

Each screen below lists what you should hear, in order. Those lines come
from that screen's file under `e2e/transcripts/`, which the test suite
checks on every change. Three things to know:

**It is what the build exposes, not what VoiceOver says.** The transcripts
are read by a virtual screen reader from Chromium's view of the page, not
by VoiceOver on iOS Safari. The **names and the order** should match what
you hear. The **words for roles and states** will not. VoiceOver usually
says them like this:

| The script says                     | VoiceOver usually says                                    |
| ----------------------------------- | --------------------------------------------------------- |
| "Add a run", heading 1              | "Add a run, heading level 1"                              |
| link "Log in"                       | "Log in, link"                                            |
| button "Log it"                     | "Log it, button"                                          |
| text field "Email"                  | "Email, text field"                                       |
| radio "Dialed", 3 of 5, not checked | "Dialed, radio button, unchecked, 3 of 5"                 |
| button "Useful", pressed            | "Useful, selected, button", or another word for on        |
| switch "Show retired", off          | "Show retired, switch button, off"                        |
| checkbox "Wind resistant"           | "Wind resistant, checkbox, unchecked"                     |
| pop-up "Category", Top              | "Category, Top, pop-up button"                            |
| disabled                            | "dimmed"                                                  |
| navigation "Main"                   | "Main, navigation", on entering it                        |
| a status message                    | the message alone, spoken when it appears                 |
| a list of 3                         | "list start" and "list end", or nothing, by your settings |

The exact wording changes between iOS versions and with the Verbosity
settings. A different word for the same fact is not a failure.

**Numbers and dates are masked.** A transcript replaces every number with
`#`, and every day and month, because they change from run to run. Here
they are written N, "the date" and "the time". You should hear the real
value: "5.2 miles", not "N".

**One step has no transcript: Turnstile (1.3).** The tests run on
Cloudflare's always-pass key, where the widget draws nothing, and a real
challenge is Cloudflare's own frame, which the virtual reader cannot enter.
That step gives the rule the screen must meet. What VoiceOver says there is
new information; write it down even when it passes.

**A transcript of an open sheet also lists the page behind it.** The
virtual reader starts at the top of the page whatever is open. VoiceOver
must not: with a sheet open, only the sheet's lines should be reachable.

If a screen and its transcript disagree, the transcript is right and this
script is stale: say so in the log.

## 3. What counts as a failure

Write a failure down when any of these happens. Copy what was said from
the Caption Panel.

| Kind                      | Example                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Something is not said     | Swiping through Create account, you never hear "Invite code". A button says only "button".           |
| Something is said twice   | "Feed, heading level 1" and then "Feed" again as its own stop.                                       |
| The order is wrong        | "Log it" is read before the five verdicts. The tab bar is read before the screen's heading.          |
| A name does not say what  | "Plus, button" where the script says "Add a run". "Link" with no name. "Image" with no name.         |
| A state is missing        | After picking "Dialed" it still says "unchecked". A picked piece does not say it is selected.        |
| Brackets are spoken       | "Left bracket, dialed dot run, right bracket", or "N" read as a symbol and not as a number.          |
| Focus is lost             | You double tap "Log it" and the next swipe starts from the top of the page, or from the address bar. |
| A sheet leaks             | With a sheet open, swiping right reaches the page behind it. The scrub does not close it.            |
| A result is silent        | A save finishes, or fails, and nothing is spoken until you go looking.                               |
| You cannot do it          | A control cannot be reached by swiping, or double tap does nothing.                                  |
| It is right but senseless | Everything is announced, and you still could not tell what the screen was for or what to do next.    |

Not failures:

- VoiceOver's wording for a role or state differs from the table in part 2.
- VoiceOver adds a hint ("double tap to activate") or a position.
- A real number where the script says N.
- Safari's own bars and buttons being read. Only the page is under test.
- A sentence read as two stops where the script shows one line, or the
  reverse, so long as nothing is lost or repeated.

When unsure, write it down and mark it "unsure". A note costs a line; a
missed failure costs a runner.

## 4. The flows

On every screen:

1. **Read all.** Four-finger tap near the top, then two-finger swipe up.
   Listen to the whole screen against "you should hear".
2. **Step through.** Four-finger tap near the top, then swipe right, one
   item at a time, as far as the screen's main action.
3. **Outline.** Rotor to Headings, swipe down through them. Each screen has
   one level 1 heading.
4. Then do what the step says.

Phone screens start with the banner (the Notifications link, once signed
in) and end with the tab bar, a navigation named "Main": link "Feed", link
"Closet", button "Add a run", link "Call", link "You". They are listed
once here and not repeated per screen. A few transcripts were read at desk
width, where the same five destinations sit in the banner instead; those
steps say so, and the content between is the same.

### Flow 1. Join and set up

**1.1 Home.** Signed out, open the build's address.
Source: `conformance/auth-landing-bar.conformance.spec.ts/logged-out-below-720-no-bar-at-all.txt`.

You should hear:

- "dialed.run", with no brackets spoken
- "Every run has an outfit. Log it.", heading 1
- "A virtual wardrobe for runners: what you wore, on which run, in which weather."
- link "Request access"
- "Have an account?", link "Log in"
- the footer links: "Privacy", "Terms", "Copyright", "Open source", "Report an intimate image"

Do: double tap "Log in", then on that screen find "New here?" and double
tap the link "Create an account". (An invite link from the Desk lands on
Create account directly.)

**1.2 Create account.**
Source: `conformance/auth-forms.conformance.spec.ts/Au-·-phone-Au1-create-account-at-rest.txt`.

You should hear:

- "dialed.run"
- "Create account", heading 1
- "dialed.run is invite-only for now."
- text field "Invite code"
- "Date of birth" and its date control
- text field "Email"
- the password field "Password", with "At least N characters."
- button "Show password"
- button "Create account"
- "or", button "Continue with Google"
- "No code?", link "Request access"
- "By creating an account you agree to the", link "Terms", "and have read the", link "Privacy policy"
- "Your runs count, without your name, in totals like the guides. You can turn that off in Settings."
- "dialed.run is for runners N and over."
- "Have an account?", link "Log in"
- the footer links

Do, in order:

1. Type an email with no "@" and a valid everything else, then double tap
   "Create account"
   (`conformance/auth-forms.conformance.spec.ts/Au-·-phone-Au1-refused-the-email-to-fix-and-the-password-shown.txt`).
   You should hear, once and without moving, "Not signed in. One field
   needs a fix.", and then land on the Email field, which reads its message
   with it and says it is invalid: "Email, That does not look like an email
   address."
2. Double tap "Show password". Move back to it. In the same transcript the
   button is now "Hide password", and the field reads what you typed.
3. Listen to "Date of birth" closely: it is a date control, and the
   transcript shows its label but not how a reader operates it. Write down
   what VoiceOver calls it and whether you could set it.
4. Fix the email and create the account.

**1.3 Turnstile**, if it appears. No transcript, and there cannot be one
(part 2). It must either pass by itself and say that it is checking, or be
reachable by swiping and passable by double tap.

**1.4 Username.**
Source: `account/username.spec.ts/a-runner-with-no-handle-yet-O0-anywhere-they-go-they-are-asked-for-a-username-first.txt`.

You should hear:

- "Step N of N"
- "What should runners call you?", heading 1
- text field "Username", with "N to N letters, numbers or underscores. It's on everything you share. You can change it in settings."
- button "Next"

**1.5 Calibrate (O1).**
Source: `conformance/onboarding-desk.conformance.spec.ts/O1-at-390-nothing-changes-no-bar-and-the-panel.txt`.

You should hear:

- "Step N of N · Optional"
- "One question does most of the work", heading 1
- a group, "Compared to people you run with, do you run warm or cold?", of five radios:
  "Always freezing, plus N degrees", "Run a little cold, plus N degrees",
  "About average, N degrees", "Run a little warm, minus N degrees",
  "Sweating in a t-shirt at N degrees, minus N degrees"
- with each radio, "The offset is visible on purpose. You'll see it change as we learn."
- text field "Where you run", with "Add the state or country. We'll show you the place we found before we use it."
- button "Find", button "Use my location"
- a group "Temperature": radios "°F" and "°C", one checked
- a group "Distance": radios "mi" and "km", one checked
- button "Start running"

Do: double tap "Run a little cold". Move away and back: it says checked,
and the other four do not. Check the group's question is heard when you
enter the group, not only once at the top.

**1.6 The tap-list (O3).**
Source: `conformance/onboarding-desk.conformance.spec.ts/O3-at-390-every-row-is-a-checkbox-and-the-counter-counts-the-taps.txt`.

You should hear:

- "Step N of N · Optional"
- "Start your closet", heading 1
- a group "Common in your climate · tap to add": one checkbox per piece, by its name, such as "Short sleeve tee", "Running tights", "Beanie", none checked
- button "Everything else · N more", collapsed
- "Closet: N pieces", "Tap what you own"
- button "Next", button "Skip for now"

Do: double tap "Running tights" and "Beanie". Each says checked (the
transcript has those two checked), and "Closet:" counts them. Write down
whether the new count was spoken without your moving.

**1.7 Name the pieces (P2.5).**
Source: `conformance/onboarding-desk.conformance.spec.ts/P2-5-for-a-runner-with-generic-pieces-P2-5-at-390-a-piece-open-for-naming-with-brands-on-offer.txt`.

You should hear:

- "Step N of N · Optional"
- "Which ones do you actually reach for?", heading 1
- "Name those. A category can't remember — a product can."
- a list, one item per piece: its name, its type and "Generic" ("Bottom · Generic"), and a button named for it, "Name it Running tights"
- "N of N named"
- button "Next", button "Skip for now"

Do: double tap "Name it" on one piece. In its place you should hear text
fields "Brand" and "Model", each with a list of suggestions, "Brand alone
is enough." and button "Save". Type two letters in Brand. The suggestions
are the browser's own list, which a transcript cannot show: write down
whether VoiceOver announced them and whether you could reach them. "Skip
for now" must be reachable without passing through every field (try the
rotor on Buttons).

**1.8 Now go run (P3).**
Source: `conformance/onboarding-desk.conformance.spec.ts/P3-at-390-the-body-is-light-as-well.txt`.

You should hear:

- "Now go run.", heading 1
- "Next time you finish a run, upload it and tell us what you wore. That's the whole loop."
- "What happens as you log", heading 2, and a list of three:
  "Weather comes with each run, fetched for when and where you ran.",
  "Each piece learns the range it actually works in, for you.",
  "After N verdicts we start making the call for you."
- "Connect Strava", heading 2, "So we can remind you. Optional."
- "Connecting Strava lets us remind you to log a kit after each run."
- "What we collect:", "How:", "Never:" and "To stop:", each with its sentence
- link "Connect with Strava"
- link "I have a run to upload", link "Done for now"

Check: the instruction comes before the Strava block, and "Optional" is
heard before the Connect link. Double tap "Done for now".

### Flow 2. Log a run

Sighted, the loop takes under 15 seconds. Do it once with the screen on,
step by step, then once with Screen Curtain (2.8).

**2.1 Add a run (A1, at rest).** From any tab, find the button "Add a run"
in the tab bar and double tap it.
Source: `conformance/a1-upload.conformance.spec.ts/A1-·-upload-at-rest-the-drop-zone-says-what-the-board-says.txt`.

You should hear "Add a run, button", and no word about a dialog or a
pop-up (round 52 #161). What opens is this screen, laid over the tab you
were on: there is no separate sheet, and the tab bar stays, with the tab
you came from still marked current. Write down what VoiceOver calls the
button; a new item is needed only if it differs.

On the screen, you should hear:

- "Add a run", heading 1
- the file control: "Drop a file, or browse, GPX / TCX / FIT. From your watch export or any tracking app."
- "No file?", link "Enter the run by hand", "instead."

Do: double tap the file control. The iOS file picker opens (it is Apple's;
not under test). Choose your run file.

**2.2 The parsed card (A1).**
Source: `run-logging/run-logging.spec.ts/A1-at-the-phone-s-width-A1-·-the-conditions-have-arrived-and-the-start-time-row-is-open.txt`
(your file's name replaces the one in it; it has the start-time row open,
which is 2.3).

Without moving, you should hear the status: "Parsed, your file's name.
Fetching weather."
(`run-logging/run-logging.spec.ts/A1-·-a-pause-is-part-of-the-run-s-time-D-111-.txt`, desk width),
and then, when the conditions arrive, "Parsed, your file's name. Weather
found."

Then, stepping through:

- "Add a run", heading 1
- "Parsed · your file's name"
- button "Replace, your file's name"
- "N miles, N minutes"
- "N minutes N seconds per mile"
- the date
- button "the time, change start time"
- "Conditions · auto-attached"
- "N degrees", "dry"
- "Feels N degrees · N % hum · N mph · overcast"
- "Never typed by hand. Wrong time? Change it on the run card and we'll get the weather for it."
- link "Weather data provided by Visual Crossing"
- link "Looks right — what did you wear?"

Check: distance, time and pace are heard as values with their units, not
as bare digits. Write down how VoiceOver reads the "Feels" line.

**2.3 Changing the start time.** Double tap the start-time button. Same
source. In the button's place you should hear:

- the time field "Start time", holding the time, with "The file said the time. Change it if your watch's clock was off."
- button "Get weather"

VoiceOver must move into the field when the row opens. Change the time and
double tap "Get weather": the new conditions must be announced when they
arrive. Then continue with "Looks right — what did you wear?".

**2.4 Attach the kit (A2).**
Source: `conformance/a2-attach.conformance.spec.ts/A2-·-before-a-suggestion-no-suggestion-one-line-no-card-and-the-picker-loses-its-OR.txt`.

You should hear, on a first run with no history:

- "What did you wear?", heading 1
- "N miles · N degrees damp · N pieces" (your conditions)
- link "Weather data provided by Visual Crossing"
- "No usual kit at N degrees yet." "Pick what you wore. After a few runs here, we'll suggest it."
- "From the closet", heading 2
- button "N degrees damp, matches conditions", pressed
- "Showing N of N"
- "Tops · N of N match", button "All Tops"
- one button per piece, by its name, not pressed
- "Bottoms · N of N match", button "All Bottoms", and its pieces
- the photo control: "Add a photo, Outfit photo · optional. Flat on the floor works best."
- button "Next — did it work?"
- "Not now —", link "leave it in the queue"

While it looks for a suggestion the same file's neighbour
(`conformance/a2-attach.conformance.spec.ts/A2-·-before-a-suggestion-waiting-only-most-likely-waits-in-the-board-s-words-and-frame.txt`)
has "Most likely", "Checking what you wore at N degrees", and the heading
becomes "Or pick from the closet".

Do: double tap two pieces. Each must then say it is pressed or selected.
On a later run, when a suggestion is offered
(`conformance/a2-attach.conformance.spec.ts/A2-·-heard-at-390-a-suggestion-the-kit-worn-last-time-it-was-like-this-and-That-s-it.txt`),
after the header you should hear "Most likely · from N degrees damp, the
date", a list of the pieces, button "That's it" and button "Change the
kit" (drawn as "Change"), and the picker's heading becomes "Or pick from the closet". "That's it" must be
within one or two swipes of the list.

**2.5 The category sheet (A2b).** Double tap "All Tops".
Source: `conformance/a2-attach.conformance.spec.ts/A2-·-heard-at-390-A2b-a-category-s-sheet-open-over-the-picker.txt`.

In the sheet you should hear:

- a dialog "Tops", and "Tops", heading 2
- "N of N match N degrees damp", "N selected"
- search field "Search"
- button "Matches conditions", pressed
- a list, one checkbox per piece: its name and its record, such as "Half-zip untested", not checked
- button "Done"

Do: double tap a piece. It says checked, and "N selected" counts it.
VoiceOver must land in the sheet and stay in it; the scrub closes it and
you are back on "All Tops".

**2.6 The verdict (A3).** Double tap "Next — did it work?".
Source: `conformance/a3-verdict.conformance.spec.ts/A3-·-round-21-before-a-verdict-five-tags-and-MORE-none-chosen.txt`.

You should hear:

- the date and time, "N miles"
- "Did it work?", heading 1
- a radio group "Did it work?": "Way cold", "A bit cold", "Dialed", "A bit warm", "Way warm", 1 to 5 of 5, none checked
- "Anything specific? · optional", heading 2
- buttons "cold first mile", "cold throughout", "overheated late", "sleeves damp", "chafed", not pressed
- button "More, anything specific"
- a group "Effort · optional": buttons "Easy", "Steady", "Workout", "Race"
- "You run warmer the harder you go. Next time, the Call allows for it."
- a group "Who sees this run", three radios:
  "Private, Only you.",
  "Shared, Runners signed in to dialed.run.",
  "Public, Anyone with the link, no sign-in. Never when or where you ran."
- with Private checked: "Other runners won't see this run. Its kit and verdict still count, anonymously, in the guides.", and button "Change whether runs count in the guides"
- button "Log it"

Do:

1. Double tap "A bit warm". It says checked; the others do not.
2. Double tap "More, anything specific". A dialog opens
   (`conformance/a3-verdict.conformance.spec.ts/A3-·-round-21-A3b-titled-with-the-verdict-it-qualifies-all-nine-tags.txt`):
   "Anything specific?", heading 2; "A bit warm · optional"; one group per
   piece, named for the piece, with radios "Fine", "Too much", "Not
   enough"; "Tags", heading 3; nine tag buttons; button "Done". Swipe right
   past "Done": you must not reach the page behind. Pick "Too much" for one
   piece and double tap "Done".
3. Back on the page, the flag is a pressed button named for the piece and
   the flag, such as "Half-zip too much"
   (`verdict/verdict.journey.spec.ts/log-a-verdict-on-your-own-run-pick-it-flag-an-item-read-the-receipt.txt` has "Houdini
   Jacket not enough"). It must say which piece it flags.

**2.7 Saving.** Double tap "Log it".
Sources: `conformance/a3-verdict.conformance.spec.ts/A3-·-round-21-Noted-nothing-moved-the-receipt-the-chips-read-only-no-MORE.txt`
(a run with no weather) and
`walkthroughs/log-a-run.walkthrough.spec.ts/log-a-run-the-file-its-conditions-the-kit-the-verdict.txt`
(with weather; desk width).

Without moving, you should hear once: "Noted." and one sentence, such as
"Merino half-zip is now N of N in N to N degrees." With no weather it is
"Logged. No weather came with this run, so no temperature record moved."

Then the screen is the receipt: the same heading, the five verdicts and
the tags now dimmed, with the verdict you picked still checked, "Noted"
and the sentence again as text, and under
them "This run", "The kit you're judging" and "Before, in N to N degrees",
each a heading 2.

Check: the button said it was working while it saved; the sentence was
spoken once, not twice; your next swipe continues from the form, not from
the top of the page.

**2.8 The whole loop, Screen Curtain on.** Three-finger triple tap. From
"Add a run" to "Noted", by ear. Time it. Write down where you got lost,
even if you recovered. Three-finger triple tap again when done.

### Flow 3. The closet

**3.1 The grid (C).** Double tap "Closet" in the tab bar.
Source: `conformance/closet-empty.conformance.spec.ts/the-heading-row-counts-the-pieces-on-the-left-the-switch-on-the-right.txt`.

You should hear:

- "N pieces", heading 1
- switch "Show retired (N)", when something is retired
- "N of N pieces are still generic — name the ones you reach for."
- a navigation "Filter the closet": three buttons, each collapsed: "Group · All", "Works at · Any", "Coverage · All"
- a list, one link per piece, each a single stop: its name, "No runs yet"
  or its runs, its range "N to N degrees" or "Untested", "Generic" where
  it is, and "Retired" where it is
- link "Add garment"

At desk width the three filters are open beside the grid instead
(`walkthroughs/first-run.walkthrough.spec.ts/the-first-run-an-invite-an-account-a-handle-and-a-closet-to-start-from.txt`).

With nothing in it
(`conformance/closet-empty.conformance.spec.ts/the-empty-closet-says-what-ruling-16-says-and-offers-the-dashed-tile.txt`):
"Nothing in here yet", heading 1; "Add what you run in most. Three pieces
is enough to start."; link "Add garment" (desk width).

Do: double tap "Group · All". It says expanded, and its choices follow. No
transcript has a filter open: write down what the choices say. Pick Tops:
the button must then say what you picked. Check each piece is one stop,
not a photo, then a name, then a type.

**3.2 Add a garment (F).** Double tap "Add garment".
Source: `closet/closet-add.spec.ts/F-puts-what-it-is-before-its-link-and-draws-its-own-▾.txt`.

You should hear:

- link "Closet"
- "Add a garment", heading 1
- pop-up "Category": Top, Bottom, Headwear, Neckwear, Gloves, Socks, Shoes, Accessory
- a group "Type" of radios (for a top: Singlet, Tee, L/S crew, Half-zip, Jacket, Vest, Sports bra)
- a group "What is it?": "Brand", "Model / name", and "Product link · optional" with "We'll read the shop's page for what it's made of. Needs a brand and model."
- a group "Attributes": pop-ups "Layer", "Weight" and "Fabric", each "Not set"; checkboxes "Wind resistant" and "Water resistant"
- a group "Visibility": Plain, Reflective trim, Hi-viz
- a group "Color" of 13 radios, each with "Pick the nearest. A print is its main color."
- text fields "Size" and "Colorway"
- the photo control: "Add a photo, Photo · optional. Flat on the floor works best. JPG, PNG or WebP."
- button "Add to closet"

Do: change Category to Shoes; the Type group must now read shoe types.
Type two letters in Brand: suggestions must be announced and reachable.
Leave Model empty and double tap "Add to closet": one sentence ending
"needs a fix", then the field with its message. Fill it and save.

**3.3 Garment detail.** Double tap a piece in the grid.
Source: `conformance/closet-detail.conformance.spec.ts/garment-detail-at-390-is-composed-as-round-22-draws-it.txt`.

You should hear:

- link "Closet"
- its category, type and size, such as "Top · Half-zip · M"
- the garment's name, heading 1
- its colorway
- the photo, as an image named for the garment, then "Replace" and button "Remove"
- "N km logged · N of N runs dialed"
- "Works at N to N degrees", button "Wrong?"
- "Pairs with · when dialed", heading 2, and its list
- link "Edit, the name", button "Retire, the name", button "Delete, the name"

Do: double tap "Retire"
(`conformance/closet-detail.conformance.spec.ts/the-retire-confirm-open-at-390-with-focus-on-Keep-it.txt`):
a dialog "Retire the, name?", heading 2; "It leaves the closet and the
picker. Its N runs and verdicts stay, and still count. You can bring it
back."; buttons "Retire" and "Keep it". VoiceOver must land on "Keep it"
and stay inside the dialog, and the scrub must close it and return you to
"Retire". On a piece that has runs, double tap "Delete"
(`conformance/closet-round26.conformance.spec.ts/Y-·-deleting-a-piece-with-runs-is-round-26-s-sheet-word-for-word.txt`):
a dialog "Delete the, name? Retire it instead.", heading 2; "It's on N
runs. Retiring takes it out of the picker and keeps everything it taught
you."; "If you delete it" and a list of three ("Goes", "Goes", "Stays",
each with its line); "This can't be undone."; buttons "Retire it", "Delete
it and its record", "Cancel". Double tap "Cancel".

### Flow 4. The feed

Before friends there is nobody to follow but your second account, and "Your
conditions" will have too few runners. Both states are below.

**4.1 Following (E1).** Double tap "Feed".
Sources: `conformance/feed-e1.conformance.spec.ts/E1-s-empty-Following-says-what-the-board-says-word-for-word.txt`
and `conformance/feed-e1.conformance.spec.ts/E1-s-v1-card-is-composed-as-the-board-draws-it-with-a-photo-without-and-indoors.txt`.

With nobody followed, you should hear:

- "Feed", heading 1
- link "Find runners"
- button "Following", pressed; button "Your conditions", not pressed
- "Nobody yet", heading 2
- "Nobody you follow has posted yet." "Follow runners you already know by their username."
- link "Find a runner"
- "Meanwhile:", button "what people wore in your conditions"

With posts, each post is an article holding one link, read as a single
stop in this order: the handle, when, the verdict, the distance, the
conditions ("N degrees · clear", or "Indoor"). Then button "Useful, the
handle's run", not pressed. "Weather data provided by Visual Crossing" is
a link after the first post.

Check: who, when, verdict, conditions, in that order, once. Not each part
again as its own stop inside the link.

**4.2 Search.** Double tap "Find runners".
Source: `feed/feed-unconfirmed.spec.ts/search-never-finds-a-runner-who-has-not-confirmed-their-address.txt`
(desk width).

You should hear "Find a runner", heading 1, and a search field "Search by
name". Type a name nobody has: without moving you should hear "No runner
called @, the name." Type your second account's handle
(`feed/feed-unconfirmed.spec.ts/search-finds-a-runner-who-has-confirmed-as-a-row-with-Follow.txt`):
without moving you should hear "N runner found.", and the list has one
row, link "@handle" and then button "Follow @handle" (drawn as "Follow").
Double tap the link.

**4.3 Someone else's profile (H).**
Source: `conformance/feed-gh.conformance.spec.ts/H-with-nothing-public-keeps-its-header-and-Follow-and-says-so-plainly.txt`.

You should hear:

- link "Back to feed"
- the handle, heading 1
- button "Follow"
- their shared runs, or "No shared runs yet." and "Follow @handle and their shared runs will show in your feed."
- button "Report or block, the handle"

Do: double tap "Follow"
(`conformance/feed-gh.conformance.spec.ts/H-after-Follow-the-button-says-Following.txt`).
The button's name becomes "Following", and it must say so without your
leaving it. The line under "No shared runs yet." becomes "Their shared
runs will show in your feed." Write down what was spoken while it worked.

**4.4 Post detail (D).** Open one of their runs.
Source: `conformance/feed-d.conformance.spec.ts/D-for-someone-else-s-entry-strip-with-badge-kit-tags-Useful-Report.txt`.

You should hear:

- link "Back to feed"
- the handle, heading 1
- the date and time, "N miles", "N minutes N seconds per mile"
- the verdict, then "N degrees · clear"
- link "Weather data provided by Visual Crossing"
- "Kit" and a list of the pieces, each with "Generic" where it is
- a list "Tags"
- button "Useful", not pressed
- button "Report this entry"

Do: double tap "Useful". It becomes "N Useful", pressed
(`walkthroughs/feed.walkthrough.spec.ts/the-feed-find-a-runner-follow-them-open-their-kit-mark-it-useful.txt`). Check the
kit is announced as a list.

**4.5 Your conditions (E2-lite).** Back to the feed; double tap "Your
conditions". Safari will ask for your location; that dialog is Apple's.
Sources: `conformance/feed-e2.conformance.spec.ts/with-the-location-granted-E2-lite-no-matches-is-the-privacy-floor-said-the-board-s-way.txt`
and `conformance/feed-e2.conformance.spec.ts/with-the-location-granted-E2-lite-widened-says-fourteen-days-in-the-teal-that-means-matched.txt`.

Too few runners (what you will get before friends):

- "Same conditions · Feels N to N degrees · dry"
- "Not enough runs yet", heading 2
- "Fewer than five runners logged N degrees and dry in two weeks, which is too few to show without showing who."
- "Your own record in this band is on the Call.", link "Open the Call"

With enough:

- "Same conditions · Feels N to N degrees · dry", and "· N days" when it looked further back
- "N runners logged this", heading 2
- "In N degrees and dry, wherever they were." and, when widened, "Too few in three days, so this looks back two weeks."
- "What they wore" and a list: the category, "N of N runners", and a sentence such as "All got it right in long sleeve."

Check: the block's title is a heading, and the count is heard with its
conditions, not apart from them.

### Flow 5. You

**5.1 Your profile (G).** Double tap "You".
Source: `conformance/feed-gh.conformance.spec.ts/G-on-day-one-shows-its-counts-at-zero-and-one-next-step-as-drawn.txt`.

You should hear:

- your handle, heading 1
- link "Settings"
- "N Runs", "N Following", "N Followers"
- your runs, or "No runs yet", heading 2, "Your runs land here once you log one. Shared runs are what other people see.", link "Log a run"

Check: each number is heard with its word, in that order.

**5.2 Notifications.** The banner's link is "Notifications", or
"Notifications, N new" when something is unread. Double tap it.
Source: `conformance/notifications-m.conformance.spec.ts/M-in-flight-white-and-dot-rows-and-Mark-all-read-breathing-in-place.txt`.

You should hear "Notifications", heading 1, and a list. Each row is its
sentence, such as "New run on Strava — log your kit?", then its date and
time.

With nothing in it
(`conformance/notifications-m.conformance.spec.ts/with-nothing-to-show-S2b-an-empty-list-says-Quiet-as-a-heading.txt`):
"Quiet", heading 2, and "Log a run and we'll ask you one question about
it. That's most of what lands here."

With something unread
(`conformance/notifications-m.conformance.spec.ts/M-at-rest-two-unread-rows-one-read-and-Mark-all-read.txt`):
button "Mark all read" comes before the list, and an unread row starts
with "Unread", then its sentence, then its date and time. A read row has
no such word. Double tap "Mark all read": the button goes and no row says
"Unread" (the first source above is that state). Write down what was
spoken when it finished.

**5.3 Settings.** From "You", double tap "Settings".
Source: `conformance/system-settings.conformance.spec.ts/the-index-U1-s-groups-and-rows-in-U1-s-order-keeping-the-tab-bar.txt`.

You should hear:

- "Settings", heading 1
- "You", heading 2: links "Account, @handle · email, password"; "How you run", with your answer or "Not answered, Answer"; "Units, Fahrenheit, miles"
- "Who sees what", heading 2: link "Privacy, New runs shared · Counted in totals"
- "Review", heading 2: links "Blocked runners, N blocked"; "Notifications, Run reminders by email"
- "Display", heading 2: a group "Theme" with radios "System", "Light", "Dark"
- "Data", heading 2: link "Connections, Strava"
- "About", heading 2: links "Privacy policy, What we keep, and who sees it"; "Terms, The rules for using dialed.run"; "Copyright, Report something of yours posted here"; "Open source, What dialed.run is built on"
- button "Sign out"

Do: rotor to Headings and swipe down: all six sections, in that order.
Open "Privacy".
Source: `conformance/system-settings.conformance.spec.ts/Privacy-at-390-who-sees-new-runs-and-the-two-switches.txt`.

You should hear:

- "Privacy", heading 1, and link "Settings"
- "Who sees new runs", heading 2, and a group of the same name: radios "Private" and "Shared", one checked
- "Public is a choice here once your profile is public. You can still make any one run public."
- button "Save"
- "Public profile · Saves as you switch", heading 2, and checkbox "Public profile", not checked, with its sentence, which starts "Off."
- "Anonymous totals · Saves as you switch", heading 2, and checkbox "Count my runs in anonymous totals", checked, with its sentence
- link "How the guides are made"

The two are drawn as switches and exposed as checkboxes, so VoiceOver may
call them either. Turn "Count my runs in anonymous totals" off and on
again: it must say the new state each time.

**5.4 Delete account.** Settings › Account, the last row.
Source: `conformance/system-settings.conformance.spec.ts/Delete-account-at-390-the-sheet-open-and-not-confirmed.txt`.

The row is a button named "Delete account", with "Deleted after 7 days.
Log in before then to keep it." as its description. The "Delete" drawn at
its right edge is not spoken. Double tap it. You should hear:

- a dialog "Delete your account?", and the same words as heading 2
- "Your runs, closet, entries and photos go in N days. Shared runs leave the feed now. Log in before the date to keep everything."
- the password field "Current password"
- button "Delete my account", button "Keep it"

VoiceOver must stay inside the dialog, and the scrub must close it and
return you to the row. **Close it. Do not confirm.**

## 5. Logging the run

Add one row to the table at the bottom of `voiceover-checklist.md`, or
tell an agent the results and it writes the row. One row per run, however
many failures.

| Date       | iOS / Safari | Who       | Failures (screen: what was said)                                                                                                     |
| ---------- | ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| YYYY-MM-DD | 27.1 / 27.1  | the owner | 2.6 A3: after "Dialed" it still said "unchecked" (#N). 3.3 Retire: the scrub did not close the dialog (#N). 2.8 curtain: 41 seconds. |

- **Failures:** the step number and screen, then what was said, from the
  Caption Panel. "None" is a valid entry.
- **Each failure becomes an issue** (`docs/agents/issue-tracker.md`), fixed
  before friends or deferred by the owner's decision, and the row carries
  its number. It is never left as a note alone.
- Also write down, outside the table, what VoiceOver said at Turnstile
  (1.3) and wherever a step asks you to write something down. That is the
  only record of those.
- If a step in this script was wrong or unclear, say so: the script is
  fixed with the failures.
