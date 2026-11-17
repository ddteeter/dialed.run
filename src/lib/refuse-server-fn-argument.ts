/**
 * A payload carries data, never a server function (SA-M25, design 230).
 *
 * TanStack Start can pass a server function as another one's argument: on
 * the way in its own adapter, keyed `$TSS/serverfn`, turns `{ functionId }`
 * into a callable. This app never passes one, so `src/start.ts` lists this
 * adapter under the same key, ahead of the framework's (the app's adapters
 * come first, and the first plugin whose tag matches decodes the node).
 *
 * - On the way out it matches nothing, so what the server sends is
 *   unchanged.
 * - On the way in it throws, so a payload that names a server function is
 *   refused while it is being read, and the request answers with an error.
 *
 * The key is the framework's wire name; `e2e/auth/server-fn-origin.spec.ts`
 * sends such a payload to the built Worker and sees it refused.
 */
export const SERVER_FN_ARGUMENT_KEY = "$TSS/serverfn";

export class ServerFnArgumentRefused extends Error {
  constructor() {
    super("a server function is not accepted as an argument");
    this.name = "ServerFnArgumentRefused";
  }
}

/**
 * The one value `test` matches. The app never sends it, so on the way out
 * nothing matches; were it sent, `toSerializable` would refuse it too.
 */
export const NEVER_SENT = Symbol("never sent");

export const refuseServerFnArgument = {
  key: SERVER_FN_ARGUMENT_KEY,
  test: (value: unknown): value is typeof NEVER_SENT => value === NEVER_SENT,
  toSerializable: (): string => {
    throw new ServerFnArgumentRefused();
  },
  fromSerializable: (): typeof NEVER_SENT => {
    throw new ServerFnArgumentRefused();
  },
};
