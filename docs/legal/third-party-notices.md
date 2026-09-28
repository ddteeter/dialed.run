# Third-party notices

Material this repository vendors — copied in, rather than installed as a
dependency — and the attribution its licence asks for. Dependencies in
`package.json` carry their own licences in `node_modules`; this file is for
what we copied.

## List of Dirty, Naughty, Obscene, and Otherwise Bad Words

- **Where:** `src/lib/profanity-words.ts`, read by `src/lib/profanity.ts`
  (the instant half of a handle's word check, task 126).
- **Source:** github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words,
  file `en`, fetched 2026-09-28.
- **Copyright:** © Shutterstock, Inc. and contributors.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/.
- **Changes:** the one entry with no letter or digit (an emoji, which no
  handle can contain) is left out. The list is otherwise unedited. Which
  entries the app actually refuses is decided in `src/lib/profanity.ts`
  (`INNOCENT_IN_HANDLES` names the listed words it lets through), not by
  editing the list.
