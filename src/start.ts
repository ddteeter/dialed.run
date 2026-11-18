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
 *
 * **A field refusal keeps its issues the same way** (R-176, design 171):
 * `lib/field-refusal`'s adapter, so a refusal the server lands on a field
 * (a denied product link) reaches `useFormSubmit` as one, and a control
 * refusal keeps its sentence (`lib/control-refusal`).
 *
 * **A server function answers only this app's own pages** (SA-M1, design
 * 230). The framework applies its CSRF middleware by default only to an
 * app with no `startInstance`, so this file lists it. Filtered to server
 * functions, of every method: a `/_serverFn/*` request whose
 * `Sec-Fetch-Site` is not `same-origin` (or, with no fetch metadata, whose
 * `Origin` or `Referer` is not this origin) answers 403 before its payload
 * is read. A loader's call during a server render is in-process and is
 * not checked here; `lib/fetch-site` is for that.
 *
 * **A payload carries data, never a server function** (SA-M25):
 * `lib/refuse-server-fn-argument` comes first, under the framework's key.
 */
import { createSerializationAdapter } from "@tanstack/react-router";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

import { signalAdapter } from "./lib/auth-signal";
import { controlRefusalAdapter } from "./lib/control-refusal";
import { fieldRefusalAdapter } from "./lib/field-refusal";
import { refuseServerFnArgument } from "./lib/refuse-server-fn-argument";
import { statementScrub } from "./lib/statement-scrub";

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
  // SA-L08: first, so it wraps every handler's error (lib/statement-scrub).
  functionMiddleware: [statementScrub],
  serializationAdapters: [
    createSerializationAdapter(refuseServerFnArgument),
    createSerializationAdapter(signalAdapter),
    createSerializationAdapter(fieldRefusalAdapter),
    createSerializationAdapter(controlRefusalAdapter),
  ],
}));
