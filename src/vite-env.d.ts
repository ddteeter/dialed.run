/**
 * Vite env flags. `vite/client` types the rest via tsconfig `types`.
 */
interface ImportMetaEnv {
  /** "off" hides in-app devtools — set by playwright.config.ts so e2e demo
   *  recordings don't capture the floating devtools button. */
  readonly VITE_DEVTOOLS?: string;
  /** "1" counts each request's D1 queries into a response header (design
   *  182) — set by playwright.config.ts for the e2e dev server only. */
  readonly VITE_D1_QUERY_TALLY?: string;
}
