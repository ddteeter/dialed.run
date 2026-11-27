/**
 * The account module's door (task 126). It exports nothing: every name
 * another module uses lives on a sub-module door (`./handles`,
 * `./access`, `./verification`, `./terms`, …), and an importer reads it
 * there (design 261 C6, design 258 proposal 13). The file stays because a
 * folder under `src/modules` is a module by having its own `index.ts`.
 *
 * Server-fn glue lives in ./functions, imported directly by route files.
 */
export {};
