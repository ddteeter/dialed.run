/**
 * The words a refused product link is told in (round 43 #93), shared by
 * the save that refuses it and Edit, which shows it again on open when the
 * stored link was denied since it was saved. Isomorphic: the form is in
 * the client bundle and the refusal is on the server.
 *
 * The runner's words, not the operator's. It says the link was not
 * accepted and stops there — naming why, or which list, would turn a
 * moderation tool into a probe anyone can query.
 */
export const DENIED_LINK =
  "That link isn't allowed here. The rest of the piece is fine.";
