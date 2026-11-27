import type { ZodType } from "zod";

/**
 * The shape every queue consumer here has: one message at a time, each
 * acked or retried on its own so one bad message never blocks a batch.
 *
 * Two consumers had written this loop out identically before the second
 * one existed, and the dupes gate said so. What they share is exactly the
 * resilience laws: a body is a trust boundary and is parsed, never cast;
 * a structurally invalid body is acked and reported, because no retry can
 * make it valid; a job that throws is retried, because the queue's own
 * redelivery and DLQ are the retry mechanism (law 3). What they do not
 * share — the schema, the work, the sentence, any extra Sentry context —
 * is what the arguments are.
 */

export interface Reporter {
  captureException: (error: unknown, context: Record<string, string>) => void;
}

export interface ConsumeHandlers<Job> extends Reporter {
  /**
  The job, and its delivery: `attempts` is 1 on the first, and counts up
  on each redelivery of the same message.
  */
  process: (job: Job, delivery: { attempts: number }) => Promise<void>;
  /**
  The sentence reported for a body the schema rejects — each consumer's
  own, so an alert says which queue's producer went wrong.
  */
  invalidMessage: string;
  /**
  Extra context for a job that threw, beside the queue and message id.
  */
  context?: ((job: Job) => Record<string, string>) | undefined;
}

/**
Every report names the queue and the message, whatever else it says.
*/
function report(
  reporter: Reporter,
  batch: MessageBatch,
  message: Message,
  error: unknown,
  extra: Record<string, string> = {},
): void {
  reporter.captureException(error, {
    queue: batch.queue,
    messageId: message.id,
    ...extra,
  });
}

/**
 * The loop itself: every message, parsed once. `job` is undefined for a
 * body the schema rejects, and what that means is the caller's policy.
 */
async function eachParsed<Job>(
  batch: MessageBatch,
  schema: ZodType<Job>,
  handle: (message: Message, job: Job | undefined) => Promise<void>,
): Promise<void> {
  for (const message of batch.messages) {
    await handle(message, schema.safeParse(message.body).data);
  }
}

export function consumeEach<Job>(
  batch: MessageBatch,
  schema: ZodType<Job>,
  handlers: ConsumeHandlers<Job>,
): Promise<void> {
  return eachParsed(batch, schema, async (message, job) => {
    if (job === undefined) {
      report(handlers, batch, message, new Error(handlers.invalidMessage));
      message.ack();
      return;
    }
    try {
      await handlers.process(job, { attempts: message.attempts });
      message.ack();
    } catch (error) {
      report(handlers, batch, message, error, handlers.context?.(job));
      message.retry();
    }
  });
}

export interface DeadLetterHandlers<Job> extends Reporter {
  /**
  What to do about a job that exhausted its retries — mark its row, tell
  its user. Nothing for a body that does not parse.
  */
  onJob: (job: Job) => Promise<void>;
  deadLettered: string;
}

/**
 * Law 6: a dead-lettered job lands where a human sees it. Every message is
 * reported and acked, whether or not it parses — the DLQ is the end of the
 * line, and leaving a message there is a silent permanent failure.
 */
export function deadLetterEach<Job>(
  batch: MessageBatch,
  schema: ZodType<Job>,
  handlers: DeadLetterHandlers<Job>,
): Promise<void> {
  return eachParsed(batch, schema, async (message, job) => {
    if (job !== undefined) await handlers.onJob(job);
    report(handlers, batch, message, new Error(handlers.deadLettered));
    message.ack();
  });
}

/**
What a re-dispatch sends, and what it says: the three callbacks and the queue.
*/
export interface RedispatchHandlers<TRow, TMessage> extends Reporter {
  queue: { send: (message: TMessage) => Promise<unknown> };
  message: (row: TRow) => TMessage;
  errorContext: (row: TRow) => Record<string, string>;
  describe: (count: number) => string;
}

/**
 * Re-dispatch a batch of rows to a queue, one message each: the producer
 * half of a reconciliation sweep, where `consumeEach` is the consumer's.
 *
 * The three re-dispatch sweeps (stalled imports, stranded Strava
 * revocations, stalled enrichments) had written this out: the early return
 * on an empty batch, the per-row `send` in a `try` so one bad row cannot
 * abandon the rest, the Sentry capture, and the anomaly line at the end.
 * They differ in the queue, the message, the Sentry context and the
 * sentence, which is what the handlers are.
 *
 * **The `try` is inside the loop on purpose and must stay there.** A
 * failed send is reported and skipped, not fatal: these are reconciliation
 * passes, so a row that cannot be dispatched this hour is picked up the
 * next. Hoisting the `try` out would let one failure strand every row
 * behind it until someone noticed.
 *
 * The anomaly is pushed on the row count, not on the number of successful
 * sends, and that is also deliberate — the digest is reporting that a
 * backlog existed, which is true whether or not the re-dispatch landed.
 */
export async function redispatchEach<TRow extends { id: string }, TMessage>(
  anomalies: string[],
  rows: readonly TRow[],
  handlers: Readonly<RedispatchHandlers<TRow, TMessage>>,
): Promise<void> {
  if (rows.length === 0) return;

  for (const row of rows) {
    try {
      await handlers.queue.send(handlers.message(row));
    } catch (error) {
      handlers.captureException(error, handlers.errorContext(row));
    }
  }
  anomalies.push(handlers.describe(rows.length));
}
