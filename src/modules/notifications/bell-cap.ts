/**
 * The most the bell's number says before it stops counting (round 22,
 * item 13): *"Caps at 9+."* Past nine the exact figure is not what a
 * runner acts on.
 *
 * Its own file because two sides read it: the bell draws `9+` past it, and
 * `bellState` reads the awaiting set one row past it and no further. The
 * component is in the client bundle, so it cannot import the service that
 * holds the queries.
 */
export const BELL_NUMBER_CAP = 9;
