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
- **Attribution:** "Weather data provided by Visual Crossing", linked to
  https://www.visualcrossing.com/, beside the conditions in the app
  (`src/ui/WeatherAttribution.tsx`) and under every guide or report built
  from them, as Visual Crossing's licence requires (D-144). This list is not
  its primary location.

## Face detection model

- **What:** the MediaPipe face detection model and runtime, served from our
  own site to run in your browser.
- **Licence:** the `@mediapipe/tasks-vision` package is Apache License 2.0
  and ships no separate NOTICE file. The BlazeFace short-range model
  (`blaze_face_short_range.tflite`) is Apache License 2.0, per Google's
  MediaPipe BlazeFace model card (short range), read 2026-10-18.

## Climate zones

- **What:** Köppen-Geiger climate classification maps, used to place runs
  in broad climate zones when anonymous totals are built (D-120).
- **Source:** the 1991–2020, 0.01° (about 1 km) map from Beck, H. E.,
  McVicar, T. R., Vergopolan, N., Berg, A., Lutsko, N. J., Dufour, A., Zeng,
  Z., Jiang, X., van Dijk, A. I. J. M., and Miralles, D. G. (2023).
  High-resolution (1 km) Köppen-Geiger maps for 1901–2099 based on
  constrained CMIP6 projections. Scientific Data 10, 724.
  https://doi.org/10.1038/s41597-023-02549-6. Data:
  https://doi.org/10.6084/m9.figshare.21789074.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/. We use the map unmodified as
  a point lookup; the zone labels on dialed.run are derived from it.
