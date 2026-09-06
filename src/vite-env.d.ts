/** Vite env flags. `vite/client` types the rest via tsconfig `types`. */
interface ImportMetaEnv {
  /** "off" hides in-app devtools — set by playwright.config.ts so e2e demo
   *  recordings don't capture the floating devtools button. */
  readonly VITE_DEVTOOLS?: string;
}
