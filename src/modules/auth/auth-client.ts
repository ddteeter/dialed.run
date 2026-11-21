/**
 * Client-side auth entry. Deliberately NOT exported from index.ts — the
 * server auth instance must never reach a client bundle. Route components
 * import this file directly.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
