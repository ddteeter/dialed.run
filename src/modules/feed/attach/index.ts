/**
 * The door of `feed/attach` (design 240, 249): the names the rest of
 * `feed` and `src/server.ts` import from it.
 */
export {
  attachContext,
  attachRunInput,
  prefillForRun,
  type AttachContext,
} from "./attach-context";
export {
  saveBacklogRow,
  type Backlog,
  type BacklogKit,
  type BacklogRow,
  type BacklogSuggestion,
  unjudgedRunCount,
  verdictBacklog,
} from "./backlog";
