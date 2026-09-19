# Task 111 — The dark theme (unscheduled)

## Goal

Ship the dark half of the design system. Round 8 delivered `Theme.dc.html`
and dark variants of every artboard — `V1 Screens - Dark`, `Product Screens -
Dark`, `Onboarding - Dark`, `Remaining Screens - Dark` — and **nothing in the
app has a dark mode today**.

## Why it is its own lane

It was not asked for. Round 8's work order had six items and this was not one
of them; design delivered it alongside. That makes it a real piece of product
work arriving without a slot, and the honest thing is to give it one rather
than let it leak into whichever lane touches a component next.

It is also broad rather than deep: every surface, every primitive, the
tokens, and the one place the app already needs it — **D-36**, which has sat
in the register since the forms contract shipped, because the design
specifies every form primitive on dark and no v1 form sits on ink.

## Scope

1. **Tokens.** `src/ui/tokens.css` gains the ink surface set. The Build Map
   artifact already carries a working example of the shape: a `:root` light
   palette, a `prefers-color-scheme: dark` block guarded with
   `:root:not([data-theme="light"])`, and a `:root[data-theme="dark"]` block
   so an explicit choice wins in both directions.
2. **The preference.** `user_profiles` has no theme column. Whether the app
   follows the system, offers a choice, or both is a product call — U1
   settings is where a choice would live.
3. **Every primitive in `src/ui`**, then every surface, against the Dark
   artboards.
4. **D-36 closes with it**: the form primitives' ink surface is specified
   (`border 1px #2A2A31 → 2px #F4F3EF`, same hi-viz band) and unwritten.
5. **The Desk is exempt and must stay exempt.** `/desk` is always dark and
   deliberately does not read the operator's preference (task 110). Whatever
   this lane builds must not reach it.

## Open questions for the owner

1. **Is a dark theme in v1 at all?** It gates nothing. The launch gate is
   106, and 110 is the operator's tool. This can sit behind the gate without
   costing anything except that the artboards exist and the code does not —
   which is exactly the state `docs/design-deltas.md` item 9 was written to
   avoid becoming invisible.
2. **System-following, explicit choice, or both?** The second needs a column
   and a settings row; the first needs neither.

## Test expectations

Whatever it touches stays at 100% in the ratchet. Component tests assert the
contract rather than the palette: CLAUDE.md's note on class-string mutants
applies — `toHaveClass` is worth asserting where the class carries a
documented rule, and is pinning a look where it does not.
