/**
 * Shared contracts between lanes — the code form of docs/contracts.md.
 * Changing anything here follows the schema-change protocol in CLAUDE.md.
 *
 * **A barrel, and nothing else.** The contracts live in `./contracts/`,
 * one file per section this file used to hold, and every importer keeps
 * reading them from here. The split is for the mutation ratchet, not for
 * readers: everything imports this file, so every mutant that runs at
 * module load re-runs every test that imports it, and one 1,055-line file
 * was one CI shard. Three shards of it run side by side instead.
 *
 * So nothing may be declared here. A barrel holds no mutants, which is the
 * only reason it can sit in whichever shard is lightest.
 */
export * from "./contracts/common";
export * from "./contracts/garments";
export * from "./contracts/products";
export * from "./contracts/verdicts";
export * from "./contracts/runs";
export * from "./contracts/weather";
export * from "./contracts/profile";
export * from "./contracts/audience";
