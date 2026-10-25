/**
 * lockfile-lint, run by `npm run lint` (design 156; docs/dependencies.md).
 *
 * Every package-lock.json entry comes from the npm registry over https,
 * carries an integrity hash, and resolves to a tarball named for the
 * package it claims to be. That last check is the one a host allowlist
 * alone misses: `lodash` resolving to `registry.npmjs.org/evil/-/evil.tgz`.
 *
 * Two exceptions, both explicit. guardrails-core installs from its GitHub
 * release, allowed by that exact URL, read from package.json so a bump needs
 * no edit here. And two packages are installed under an npm alias by a
 * dependency's own package.json, so their names differ from their tarballs
 * on purpose; a new alias fails until it is read and added.
 */
import { readFileSync } from "node:fs";

// npm runs scripts from the package root, so this is the package's own file.
const { devDependencies } = JSON.parse(readFileSync("package.json", "utf8"));

export default {
  path: "package-lock.json",
  type: "npm",
  "validate-https": true,
  "validate-integrity": true,
  "validate-package-names": true,
  "empty-hostname": false,
  "allowed-hosts": ["npm"],
  "allowed-urls": [devDependencies["guardrails-core"]],
  "allowed-package-name-aliases": [
    // @cf-wasm/resvg's own dependency, `npm:@resvg/resvg-wasm`.
    "@resvg/resvg-wasm-legacy:@resvg/resvg-wasm",
    // @tanstack/start-server-core's own dependency, `npm:h3`.
    "h3-v2:h3",
  ],
};
