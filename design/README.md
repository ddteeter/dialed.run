# dialed.run — design source

Imported from the Claude Design project **"Runner Wardrobe App Brief"**.

Source: https://claude.ai/design/p/2da6f14b-dee4-4d4a-8f00-9ffd0f3ac3fd
Project ID: `2da6f14b-dee4-4d4a-8f00-9ffd0f3ac3fd`
Imported: 2026-08-30 · **Revision 3 imported 2026-08-30** (rev 2 added `V1 Screens.dc.html` with the K/L/M/N/P/Q surfaces and post-v1 markings; rev 3 lands the identity-first wardrobe round: F identity-first + F2 enrichment states, P2.5 naming step, [GENERIC] badges, public-entry ownership counts, Strava-notification compliance fix)

## Files

| File | What it is |
| --- | --- |
| `Brand Brief.dc.html` | Name rationale, logo direction, color system, typography, voice, product principles, lexicon, UI application. The canonical brand spec. |
| `Flow Map.dc.html` | Developer handoff. Navigation structure, per-flow failure modes, empty states, system states, and the four-milestone build order. |
| `Logo Directions.dc.html` | Eleven logo exploration studies, rounds 1–2. Direction resolved to bracket notation (see Brand Brief §02). |
| `Onboarding.dc.html` | O1–O6: calibrate, shoot the closet, fill the long tail, seed history, first call, the calibration ladder. Each screen carries a background-systems note. |
| `Product Screens.dc.html` | A1–A3 + A2b (log a run), B1–B2 (the call), C (closet, desktop), D (post detail). |
| `V1 Screens.dc.html` | K (call teaser), L (Strava connect), M (notifications), N (settings & privacy), P2/P2.5/P3 (onboarding v1 incl. the naming step), Q (manual entry + indoor). |
| `Remaining Screens.dc.html` | E1–E2 (feed), F (add a garment), G (your profile), H (someone else), I (discovery), J (gear gaps). |
| `support.js` | Generated dc-runtime that renders the `.dc.html` artboards. **Not product code** — do not edit; it is regenerated upstream. |

## Viewing

Each `.dc.html` is a standalone page that loads `./support.js` from this
directory, so keep them together. Open one directly in a browser, or serve
the folder:

```sh
python3 -m http.server -d design 8000
```

## Notes for implementation

- These are **artboards**, not app code. The markup is inline-styled canvas
  output; treat it as a visual spec to read, not a codebase to port.
- `{{ brandWord }}` and `{{ reactionUpper }}` are canvas template props, not
  product strings. Some files also use `<sc-if>` blocks for togglable sections.
- The Flow Map's milestone order is the recommended build sequence, starting
  with "prove the loop": add garment (F), log a run (A1–A3), the call (B1–B2).
- The Flow Map opens with a validation warning worth heeding: test the
  recommendation by hand against held-out runs before building the engine.
- Several decisions are explicitly still open — three- vs five-state verdicts,
  how much social signal enters the call, whether verdicts are ever public,
  and "useful" vs "like" as the primary reaction.
