/**
 * TanStack Start's options (the framework reads `startInstance` from this
 * file by name).
 *
 * **The auth signals keep their code across a server function's
 * response** (design 133). Start serializes a thrown `Error` as its
 * message alone, so `AUTH_REQUIRED`, `TERMS_NOT_ACCEPTED` and
 * `EMAIL_UNCONFIRMED` reached the client as plain errors and every refusal
 * read as a failure. The adapter is `lib/auth-signal`'s `signalAdapter`,
 * where its decisions are tested; this file is glue, and cannot be
 * imported by a test (it pulls the framework's entries).
 */
import { createSerializationAdapter } from "@tanstack/react-router";
import { createStart } from "@tanstack/react-start";

import { signalAdapter } from "./lib/auth-signal";

export const startInstance = createStart(() => ({
  serializationAdapters: [createSerializationAdapter(signalAdapter)],
}));
