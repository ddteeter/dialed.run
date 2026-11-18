import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  scrubbed,
  scrubNext,
  statementScrub,
} from "../../src/lib/statement-scrub";
import { startInstance } from "../../src/start";

const failure = new DrizzleQueryError(
  'select "id" from "session" where "token" = ?',
  ["the-session-token"],
  new Error("D1_ERROR: database is locked"),
);

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("nothing was thrown");
}

describe("the statement scrub (SA-L08)", () => {
  it("is the first function middleware every server function runs", async () => {
    const options = await startInstance.getOptions();
    expect(options.functionMiddleware?.[0]).toBe(statementScrub);
  });

  it("is a function middleware whose server half is the scrub", () => {
    expect(statementScrub.options).toStrictEqual({
      type: "function",
      server: scrubNext,
    });
  });

  it("rethrows a failed statement without its bound values", async () => {
    const thrown = await thrownBy(() =>
      scrubbed(() => Promise.reject(failure)),
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown instanceof Error ? thrown.message : "").toBe(
      'failed statement select "id" from: D1_ERROR: database is locked',
    );
    expect(String(thrown)).not.toContain("the-session-token");
  });

  it("lets a zod refusal and any other error through as thrown", async () => {
    // A redirect is a Response, which withoutBoundValues' own test passes.
    const refusal = z.string().safeParse(1).error ?? new Error("parsed");
    const plain = new Error("boom");
    for (const error of [refusal, plain]) {
      expect(await thrownBy(() => scrubbed(() => Promise.reject(error)))).toBe(
        error,
      );
    }
  });

  it("hands back what the handler answered", async () => {
    expect(await scrubbed(() => Promise.resolve({ ok: true }))).toStrictEqual({
      ok: true,
    });
  });

  it("is scrubNext, which scrubs what `next` throws", async () => {
    expect(statementScrub.options.server).toBe(scrubNext);
    const thrown = await thrownBy(() =>
      scrubNext({ next: () => Promise.reject(failure) }),
    );
    expect(String(thrown)).not.toContain("the-session-token");
    expect(String(thrown)).toContain("failed statement");
  });
});
