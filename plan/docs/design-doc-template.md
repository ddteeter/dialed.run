# Design: <task-id> <name>

> Hard cap: one page (~60 lines). If you exceed it, cut. The reviewer reads
> this on a phone. Diagrams count as clarity, not length.

## Problem
Two or three sentences. What this lane delivers and why, in product terms.

## Approach
The shape of the solution. Name the modules/files you'll create. If the
structure is non-obvious, one Mermaid diagram (sequence for flows, flowchart
for structure) — otherwise skip the diagram.

## Contract touches
- Schema changes needed: **none** | list them (list ⇒ STOP for review first)
- New routes (manifest namespace entries): list
- New bindings/queues/crons: **none** | list (list ⇒ human-managed, flag it)

## Test plan
Bullet list of the tests you will write, by name. Unit vs integration marked.

## Open questions
Anything you'd otherwise guess on. Empty is acceptable; wrong guesses are not.
