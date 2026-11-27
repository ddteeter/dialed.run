/**
 * `ops` has no names of its own on this door (design 261, C7): every one
 * lives on a sub-module, and other modules import the narrowest door the
 * name is on (`ops/outbox`, `ops/sentry`, `ops/edge`, `ops/public-web`,
 * `ops/limits`, `ops/gave-up`, …). Route files reach the Desk through
 * `./functions` and `./client`.
 */
export {};
