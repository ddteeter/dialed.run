import type { JSX } from "react";

import { NotFoundState } from "./modules/auth/components/SystemState";
import { PIECE_NOT_FOUND } from "./modules/closet/piece-not-found";
import { bellLoader } from "./modules/notifications/components/bell-loader";
import { bellStateFn } from "./modules/notifications/functions";
import { RUN_NOT_FOUND } from "./modules/runs/run-not-found";

/**
 * Round 55 · 185's named not-founds, beside the router's own (`router.tsx`)
 * and for the same reasons: X1 is auth's state, which a module reaches only
 * through an index that reads the environment, and the bell is read after
 * mount for a page no loader of ours finished. A route hands one of these
 * to `notFoundComponent`; it is a screen of its own, with its own heading.
 * Both are signed in: their loaders ask for a session before the thing.
 */
const loadBell = bellLoader(() => bellStateFn());

export function PieceNotFoundPage(): JSX.Element {
  return (
    <NotFoundState signedIn loadBell={loadBell} subject={PIECE_NOT_FOUND} />
  );
}

export function RunNotFoundPage(): JSX.Element {
  return <NotFoundState signedIn loadBell={loadBell} subject={RUN_NOT_FOUND} />;
}
