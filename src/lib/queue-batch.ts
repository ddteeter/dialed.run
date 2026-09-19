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
  process: (job: Job) => Promise<void>;
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
      await handlers.process(job);
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
