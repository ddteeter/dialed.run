import { describe, expect, it } from "vitest";

// Inlined by Vite at build time. The workers test pool sandboxes the real
// filesystem (readFileSync resolves inside /bundle), so `?raw` is how the
// config's actual bytes reach an assertion.
import wranglerJsonc from "../wrangler.jsonc?raw";

import { cronSchedules } from "../src/modules/ops/crons";
import { consumedQueueNames, queueRegistry } from "../src/modules/ops/queues";

/**
 * wrangler.jsonc is human-managed (CLAUDE.md forbidden zones) and the code
 * that depends on it is not. That split is fine as long as a mismatch is
 * loud, and until this test existed it was silent: an unregistered cron
 * simply never fired, and an unbound queue consumer simply never ran, with
 * the handler code sitting there looking correct.
 */

/**
 * Strips JSONC comments and trailing commas by scanning, not by regex —
 * a regex either backtracks badly on block comments or cheerfully eats the
 * `//` inside a string literal. Neither is worth risking on the file that
 * decides what runs in production.
 *
 * `charAt` rather than indexing: it returns "" past the end, so the scan
 * needs no undefined handling at every step.
 */
function skipString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (char === '"') break;
  }
  return index;
}

function skipComment(source: string, start: number): number {
  if (source.charAt(start + 1) === "/") {
    let index = start;
    while (index < source.length && source.charAt(index) !== "\n") index += 1;
    return index;
  }
  let index = start + 2;
  while (
    index < source.length &&
    !(source.charAt(index) === "*" && source.charAt(index + 1) === "/")
  ) {
    index += 1;
  }
  return index + 2;
}

function stripJsonc(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source.charAt(index);
    if (char === '"') {
      const end = skipString(source, index);
      out += source.slice(index, end);
      index = end;
      continue;
    }
    if (char === "/") {
      index = skipComment(source, index);
      continue;
    }
    out += char;
    index += 1;
  }
  // Trailing commas: legal in JSONC, fatal to JSON.parse.
  return out.replaceAll(/,(\s*[\]}])/g, "$1");
}

const configSchemaError = "wrangler.jsonc did not have the expected shape";

function crons(config: unknown): string[] {
  if (typeof config !== "object" || config === null) {
    throw new Error(configSchemaError);
  }
  if (!("triggers" in config)) return [];
  const { triggers } = config;
  if (typeof triggers !== "object" || triggers === null) {
    throw new Error(configSchemaError);
  }
  if (!("crons" in triggers)) return [];
  const { crons: values } = triggers;
  if (!Array.isArray(values)) throw new Error(configSchemaError);
  return values.map(String);
}

interface BoundConsumer {
  queue: string;
  dlq: string | undefined;
}

function queueConsumers(config: unknown): BoundConsumer[] {
  if (typeof config !== "object" || config === null) {
    throw new Error(configSchemaError);
  }
  if (!("queues" in config)) return [];
  const { queues } = config;
  if (typeof queues !== "object" || queues === null) {
    throw new Error(configSchemaError);
  }
  if (!("consumers" in queues)) return [];
  const { consumers } = queues;
  if (!Array.isArray(consumers)) throw new Error(configSchemaError);
  return consumers.map((consumer: unknown) => {
    if (typeof consumer !== "object" || consumer === null) {
      throw new Error(configSchemaError);
    }
    return {
      queue: "queue" in consumer ? String(consumer.queue) : "",
      dlq:
        "dead_letter_queue" in consumer
          ? String(consumer.dead_letter_queue)
          : undefined,
    };
  });
}

describe("wrangler.jsonc matches the code that depends on it", () => {
  const config: unknown = JSON.parse(stripJsonc(wranglerJsonc));

  it("registers every cron the scheduled handler knows how to run", () => {
    // Sets, not sorted arrays: order is meaningless here and ES2022 has
    // no toSorted, which the lint config would otherwise demand.
    expect(new Set(crons(config))).toEqual(new Set(cronSchedules));
  });

  it("binds a consumer for every queue the batch handler switches on", () => {
    expect(
      new Set(queueConsumers(config).map((consumer) => consumer.queue)),
    ).toEqual(new Set(consumedQueueNames));
  });

  it("routes each consumer to the dead-letter queue the handler expects", () => {
    const bound = new Map(
      queueConsumers(config).map((consumer) => [consumer.queue, consumer.dlq]),
    );
    for (const entry of queueRegistry) {
      expect(
        bound.get(entry.queue),
        `dead_letter_queue for ${entry.queue}`,
      ).toBe(entry.deadLetterQueue);
    }
  });
});
