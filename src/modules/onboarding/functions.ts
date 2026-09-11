/**
 * Server-fn glue (imported directly by route files, per modules/auth's
 * pattern) — keeps this module's other files loadable in the vitest
 * workers pool with no TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireUserId } from "../auth";
import { coverageLadder } from "../feed";
import { ladderFrom } from "./ladder";

export const callLadderQuery = createServerFn({ method: "GET" }).handler(
  async () => ladderFrom(await coverageLadder(await requireUserId())),
);
