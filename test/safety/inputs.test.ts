import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  banUserInput,
  blockRunnerInput,
  denyDomainInput,
  fileReportInput,
  reviewDecisionInput,
} from "../../src/modules/safety";

/**
 * The trust boundary, and the place this app's error copy lives.
 *
 * Both sides run these schemas (`ui/use-form-submit`'s "one schema, run
 * twice"), so a message here is the sentence a runner reads — which makes
 * the messages worth asserting, not just the accept/reject.
 */

describe("filing a report", () => {
  it("accepts a minimal report", () => {
    const parsed = fileReportInput.parse({
      subjectType: "entry",
      subjectId: "e-1",
      reason: "spam",
    });
    expect(parsed).toMatchObject({ subjectType: "entry", reason: "spam" });
  });

  it("refuses a reason that is not one of the artboard's", () => {
    const result = fileReportInput.safeParse({
      subjectType: "entry",
      subjectId: "e-1",
      reason: "sexual_content",
    });
    expect(result.success).toBe(false);
  });

  it("refuses an empty subject id", () => {
    // An empty id would match no row and quietly file a report about
    // nothing.
    const result = fileReportInput.safeParse({
      subjectType: "entry",
      subjectId: "",
      reason: "spam",
    });
    expect(result.success).toBe(false);
  });

  it("bounds the subject id, since it is not always a ULID", () => {
    // Profile ids come from Better Auth rather than newUlid, so this is a
    // length bound rather than a format — but unbounded would let a
    // report carry a megabyte of text as its subject.
    const result = fileReportInput.safeParse({
      subjectType: "profile",
      subjectId: "x".repeat(65),
      reason: "spam",
    });
    expect(result.success).toBe(false);
  });

  it("makes the note optional, because W1 says a line or two is plenty", () => {
    const parsed = fileReportInput.parse({
      subjectType: "entry",
      subjectId: "e-1",
      reason: "other",
    });
    expect(parsed.note).toBeUndefined();
  });

  it("trims the note", () => {
    const parsed = fileReportInput.parse({
      subjectType: "entry",
      subjectId: "e-1",
      reason: "other",
      note: "  spacing  ",
    });
    expect(parsed.note).toBe("spacing");
  });

  it("caps the note in the runner's own words", () => {
    const result = fileReportInput.safeParse({
      subjectType: "entry",
      subjectId: "e-1",
      reason: "other",
      note: "x".repeat(501),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Keep it under 500 characters — a line or two is plenty.",
    );
  });

  it("carries the block choice when it is made", () => {
    const parsed = fileReportInput.parse({
      subjectType: "profile",
      subjectId: "u-1",
      reason: "harassment",
      alsoBlock: true,
    });
    expect(parsed.alsoBlock).toBe(true);
  });
});

describe("blocking", () => {
  it("takes a user id", () => {
    expect(blockRunnerInput.parse({ userId: "u-1" })).toEqual({ userId: "u-1" });
  });

  it("refuses an empty one", () => {
    expect(blockRunnerInput.safeParse({ userId: "" }).success).toBe(false);
  });
});

describe("a review decision", () => {
  it("takes a queue ULID and one of two decisions", () => {
    const queueId = newUlid();
    expect(reviewDecisionInput.parse({ queueId, decision: "remove" })).toEqual({
      queueId,
      decision: "remove",
    });
  });

  it("refuses a queue id that is not a ULID", () => {
    // These ARE ours, unlike a subject id, so the format can be strict.
    expect(
      reviewDecisionInput.safeParse({ queueId: "nope", decision: "approve" })
        .success,
    ).toBe(false);
  });

  it("refuses a third decision", () => {
    // Two buttons, two decisions. Anything else arriving here is a
    // client that has drifted from the contract.
    expect(
      reviewDecisionInput.safeParse({
        queueId: newUlid(),
        decision: "maybe",
      }).success,
    ).toBe(false);
  });
});

describe("banning", () => {
  it("requires a reason, unlike a report's note", () => {
    const result = banUserInput.safeParse({ userId: "u-1", reason: "" });
    expect(result.success).toBe(false);
    // A ban is the heaviest thing this app does to a person and the
    // notice quotes this back to them, so "no reason given" is not an
    // acceptable state for it to be in.
    expect(result.error?.issues[0]?.message).toBe(
      "Say why — the ban notice quotes this back to them.",
    );
  });

  it("accepts one", () => {
    expect(
      banUserInput.parse({ userId: "u-1", reason: "harassment" }),
    ).toMatchObject({ reason: "harassment" });
  });

  it("caps it", () => {
    expect(
      banUserInput.safeParse({ userId: "u-1", reason: "x".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("trims it, so whitespace is not a reason", () => {
    expect(
      banUserInput.safeParse({ userId: "u-1", reason: ' '.repeat(3) }).success,
    ).toBe(false);
  });
});

describe("denying a domain", () => {
  it("accepts a bare host", () => {
    expect(denyDomainInput.parse({ domain: "spam.example" })).toMatchObject({
      domain: "spam.example",
    });
  });

  it("accepts a whole URL, because that is what a reviewer has pasted", () => {
    // Deliberately loose — `domainOf` normalises either form to the same
    // stored value, and a strict pattern would reject the thing most
    // likely to be in the clipboard.
    expect(
      denyDomainInput.safeParse({ domain: "https://spam.example/page" })
        .success,
    ).toBe(true);
  });

  it("refuses an empty domain, in the reviewer's words", () => {
    const result = denyDomainInput.safeParse({ domain: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter a domain.");
  });

  it("refuses something with spaces in it", () => {
    const result = denyDomainInput.safeParse({ domain: "two words" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("A domain has no spaces in it.");
  });

  it("refuses one longer than any real domain", () => {
    expect(
      denyDomainInput.safeParse({ domain: "x".repeat(254) }).success,
    ).toBe(false);
  });

  it("makes the reason optional", () => {
    expect(denyDomainInput.parse({ domain: "spam.example" }).reason).toBeUndefined();
  });
});
