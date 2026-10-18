# Third-party notices

Material this repository vendors — copied in, rather than installed as a
dependency — and the attribution its licence asks for. Dependencies in
`package.json` carry their own licences in `node_modules`; this file is for
what we copied.

## List of Dirty, Naughty, Obscene, and Otherwise Bad Words

- **Where:** `src/lib/contracts/profanity-words.txt`, one entry per line as
  upstream publishes it, read by `src/lib/contracts/profanity.ts` (the instant half
  of a handle's word check, task 126).
- **Source:** github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words,
  file `en`, fetched 2026-09-28.
- **Copyright:** © Shutterstock, Inc. and contributors.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/.
- **Changes:** the one entry with no letter or digit (an emoji, which no
  handle can contain) is left out. The list is otherwise unedited. Which
  entries the app actually refuses is decided in `src/lib/contracts/profanity.ts`
  (`INNOCENT_IN_HANDLES` names the listed words it lets through), not by
  editing the list.

## Weather data

- **Source:** Visual Crossing Corporation.
- **Attribution:** shown next to conditions in the app
  (`src/ui/WeatherAttribution.tsx`) and on every guide or report built from
  them. [OWNER: exact wording from research rev. 3 item 7.]

## Face detection model

- **What:** the MediaPipe face detection model and runtime, served from our
  own site to run in your browser.
- **Licence:** the `@mediapipe/tasks-vision` package is Apache License 2.0
  and ships no separate NOTICE file. The BlazeFace short-range model
  (`blaze_face_short_range.tflite`): [OWNER: confirm its licence from
  Google's model card, research rev. 3 item 8.]

## Climate zones

- **What:** Köppen-Geiger climate classification maps, used to place runs
  in broad climate zones when anonymous totals are built (D-120).
- **Source and licence:** [OWNER: the dataset, its authors and year, its
  licence and credit line, from research rev. 3 item 8.]
