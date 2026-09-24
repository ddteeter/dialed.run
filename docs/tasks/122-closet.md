# Task 122 — Closet: C, F, edit, garment detail

Lane 2 of 4 building to rounds 21–23. Read
`121-124-build-to-rounds-21-23.md` first — the shared rules live there.

## You own

- `src/modules/closet/**`, `src/routes/closet/**`
- `src/modules/products/**` only if a closet change needs it
- `e2e/closet/`, new `e2e/conformance/closet-*`

## Screens and what changes

**Garment detail** (Round 22 `#y`: "Y Garment detail", "Y Garment detail
1040", "Y Retire confirm", "Y Retired garment"; item 7 ruling).

- Order: identity, photo, stats, works at, composition, pairs with, actions.
  Task 120 already put the photo in the well straight after identity.
- Photo is 4:3 full column: 262 tall on phone, 320 cap at desk.
- Delete is a text link, apart from Edit and Retire.
- Retire confirms, as drawn. The Flow Map names the confirm and D-102 lists
  it.
- Draw the retired garment as the frame does.
- **Remove photo.** `FileWell` already takes `onRemove`. Add the server
  function: clear `photo_key`, delete the R2 objects, and batch where the
  writes belong together (CLAUDE.md D1 discipline). Then pass it in.

**Closet at desk, no rail** (Round 22 item 16 ruling; D-94's rail is still
out of scope).

- Heading row: "47 pieces" on the left, a "Show retired" switch on the
  right.
- Retired tiles: the same tile, [RETIRED] in the kicker, sorted last, no
  dimming.
- Empty: "[ NOTHING IN HERE YET ]" + "Add what you run in most. Three pieces
  is enough to start." + the dashed Add tile.

**F · add garment** (Remaining F; item 17 ruling).

- Remove the product-link field for v1 (AC2b). F2a and F2b return with
  enrichment.
- Order: AH1 identity → Size → Colorway → photo well → Add to closet.
- **Edit** is F prefilled, titled "Edit {name}", with a Save button.

## Conformance specs

- **Add specs** for garment detail (phone and 1040), the retire confirm, and
  the closet's empty state.

## Demo

- Extend `e2e/closet/closet.demo.spec.ts`. It already adds a photo; add
  Remove, the retire confirm and the retired tile.
