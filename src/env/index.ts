/**
 * The ONLY module that touches Workers bindings (CLAUDE.md architecture
 * rules; enforced by dependency-cruiser). Everything else imports `env`
 * from here.
 */

export { env } from "cloudflare:workers";
