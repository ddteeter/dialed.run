import { NotFoundError } from "../../lib/errors";

/**
 * The Desk's door (decision D-35): an operator gets in, anyone else gets
 * not-found — never a 403, because the Desk is never linked and a refusal
 * would confirm to a stranger that there is something here to refuse.
 *
 * Its own file, importing nothing server-side, because **a route calls
 * it**: `routes/desk/route.tsx` runs it in `beforeLoad`, so every page
 * under `/desk` — this lane's and the ones 126 and 128 add — is behind it
 * without asking. The question itself (`isOperator`) is answered on the
 * server; this only turns the answer into the router's 404.
 *
 * A page's own server functions still check `requireAdmin`: this gate
 * decides what renders, not what a direct call to a server function may
 * do.
 */
export function operatorOrNotFound(access: { readonly operator: boolean }) {
  if (!access.operator) throw new NotFoundError("no desk here");
}
