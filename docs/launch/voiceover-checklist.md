# VoiceOver checklist (iPhone, Safari)

Plan 161, step 9. The automated checks see the DOM: axe, the Tab walk, reflow,
and the transcripts (Guidepup's _virtual_ reader). None of them sees
VoiceOver's gestures, its rotor, iOS Safari's own reading of the page, or
whether a screen makes sense when heard rather than seen. This pass is the
part a person has to do, on a real iPhone, before friends get access
(`docs/launch/deployment-plan.md` §11, stage 1). Run it again before public launch, and
after any change to a flow below.

Record each run at the bottom of this file: the date, the iOS and Safari
versions, who ran it, and every failure, with the screen and what was said.
A failure is fixed or written into `docs/deferred.md` with the owner's
decision. It is never left as a note here.

## Before you start

- iPhone on the current iOS, Safari, signed out, a fresh account to sign up
  with, and one GPX file (any recent run).
- Settings › Accessibility › VoiceOver on. Speaking rate at your normal
  listening speed. Screen Curtain (three-finger triple tap) **on** for the
  logging loop: if you can't do it without the screen, a VoiceOver user
  can't either.
- Add the rotor items you will use: Headings, Landmarks, Form Controls,
  Links, Buttons.

## The gestures each screen must survive

On every screen in the flows below, check each of these. Most failures show
up as something unsaid, said twice, or said in the wrong order.

1. **Swipe right from the top** reads the screen in the order it is drawn:
   bar, heading, content, primary action, tab bar. Nothing is skipped and
   nothing is read twice in a row.
2. **The rotor's Headings** lists one level-1 heading, the screen's title,
   with the sections under it. Two-finger swipe up (read all) reads the
   whole screen without stopping.
3. **The rotor's Landmarks** finds the banner, the main content and the tab
   bar's navigation.
4. **Every control says what it is and what it does**: "Log a run, button",
   not "button" or "plus". An icon-only control has a name. A selected tab
   or chip says "selected".
5. **Brackets are drawn, not said.** You hear "dialed.run", not "left
   bracket dialed dot run right bracket", and a measured value reads as its
   number and unit.
6. **Double tap activates**, and focus lands somewhere sensible afterwards:
   on the sheet that opened, the screen that loaded, or the message that
   appeared. It does not go back to the top of the page.
7. **A sheet or dialog keeps VoiceOver inside it** until it closes. Two-finger
   scrub (Z) closes it, and focus returns to what opened it.
8. **Pending is announced.** A button that is working says so ("Saving"),
   and the result is said once without your moving there: "Run logged.",
   "Nothing saved. One field needs a fix." (`docs/product.md` §Forms).

## The flows

Each line is a screen. Check the gestures above on each, plus what is
listed.

### 1. Join and set up

- [ ] Home: the hero heading is read first after the bar, and "Log in",
      "Create an account" and "Request access" are links or buttons by
      those names.
- [ ] Create an account: each field's label is read with the field. A wrong email is
      announced once, as the field's message, when you submit. The password
      reveal says whether the password is shown.
- [ ] Turnstile (if shown): it can be reached and passed by VoiceOver, or
      says it is checking without needing a tap.
- [ ] O1, Calibrate: the five levels are read together as one group with its
      question, and the chosen one says "selected".
- [ ] O3, the tap-list: each item says whether it is checked.
- [ ] P2.5, Name the pieces: brand suggestions are announced as they appear,
      and the skip is reachable without going through every field.
- [ ] P3, Now go run: the instruction is read before the reassurance, and
      "Connect Strava" says it is optional.

### 2. Log a run (the loop, under 15 seconds sighted)

- [ ] + Add: "Upload a file" can be reached and opens the iOS file picker.
- [ ] A1, the parsed card: distance, time and pace are read as values with
      units, the conditions after them. "6:04 AM, change start time" is a
      button.
- [ ] Changing the start time: the row opens in place, focus moves into it,
      and the new conditions are announced when they arrive.
- [ ] A2, Attach the kit: "That's it" is reachable in one or two swipes from
      the heading, and each picked item says "selected".
- [ ] A2b, the category sheet: VoiceOver stays inside, and closing it
      returns focus to the item that opened it.
- [ ] A3, the verdict: the five verdicts are read in order with the chosen
      one "selected". A per-item flag says which item it flags.
- [ ] Saving: "Run logged." is said once, and you land on the receipt.
- [ ] The whole loop, Screen Curtain on, from + Add to the receipt.

### 3. The closet

- [ ] C, the grid: each garment is one stop that says its name and category,
      not a photo, then a name, then a type.
- [ ] Condition filters say which filter is on.
- [ ] F, Add a garment: Category and Type first, then Brand and Name. Each
      select says its label and value, and the brand suggestions are
      reachable.
- [ ] Garment detail: the stats are read as values with units, and Retire
      asks for confirmation in a dialog VoiceOver stays inside.

### 4. The feed

- [ ] E1, Following: each post is one link that says who, when, the verdict
      and the conditions, in that order, and not every part again inside it.
- [ ] E2-lite, Your conditions: the block's title is a heading, and "N
      runners logged this" is read with its conditions.
- [ ] D, Post detail: the kit is a list, and "Useful" says whether you have
      marked it.
- [ ] H, Someone else's profile: "Follow" says whether you follow them.
- [ ] Search: results are announced as they arrive, or the count is.

### 5. You

- [ ] G, Your profile: your handle is the heading.
- [ ] Notifications: unread ones say "unread". "Mark all read" is a button.
- [ ] Settings: each switch or checkbox says its label and its state. Each section is
      reachable from the rotor's Headings.
- [ ] Delete account: it asks in a dialog, and the confirm says what it
      deletes.

## Runs

| Date | iOS / Safari | Who | Failures (screen: what was said) |
| ---- | ------------ | --- | -------------------------------- |
|      |              |     |                                  |
