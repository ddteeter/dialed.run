import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import {
  banUserInput,
  blockRunnerInput,
  denyDomainInput,
  fileReportInput,
  removalDecisionInput,
  reviewDecisionInput,
  takedownRequestInput,
} from "../../src/modules/safety";
import { runRemovalsInput } from "../../src/modules/safety/inputs";
import { declineReasonField } from "../../src/modules/safety/contracts";

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
    expect(blockRunnerInput.parse({ userId: "u-1" })).toEqual({
      userId: "u-1",
    });
  });

  it("refuses an empty one", () => {
    expect(blockRunnerInput.safeParse({ userId: "" }).success).toBe(false);
  });
});

describe("a review decision", () => {
  it.each(["approve", "remove"])("takes a queue ULID and %s", (decision) => {
    // Both, not one: the enum names two decisions and a test that only
    // ever sends "remove" cannot tell whether "approve" is still in it.
    const queueId = newUlid();
    expect(reviewDecisionInput.parse({ queueId, decision })).toEqual({
      queueId,
      decision,
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

  it("caps it, in the reviewer's own words", () => {
    const result = banUserInput.safeParse({
      userId: "u-1",
      reason: "x".repeat(501),
    });
    expect(result.success).toBe(false);
    // Error copy lives in the schema, so the sentence is part of the
    // contract rather than an implementation detail.
    expect(result.error?.issues[0]?.message).toBe(
      "Keep it under 500 characters.",
    );
  });

  it("trims it, so whitespace is not a reason", () => {
    expect(
      banUserInput.safeParse({ userId: "u-1", reason: " ".repeat(3) }).success,
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
    expect(result.error?.issues[0]?.message).toBe(
      "A domain has no spaces in it.",
    );
  });

  it("refuses one longer than any real domain, and says so", () => {
    const result = denyDomainInput.safeParse({ domain: "x".repeat(254) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "That is longer than any real domain.",
    );
  });

  it("trims what was pasted, because a clipboard carries whitespace", () => {
    // Untrimmed, the stored domain would be " spam.example" and would
    // never match the host of a link anyone actually saved.
    expect(denyDomainInput.parse({ domain: "  spam.example  " }).domain).toBe(
      "spam.example",
    );
  });

  it("makes the reason optional", () => {
    expect(
      denyDomainInput.parse({ domain: "spam.example" }).reason,
    ).toBeUndefined();
  });

  it("trims the reason and caps it", () => {
    // The same treatment the domain gets. Without the cap a reviewer can
    // paste a page into a column the review UI renders inline; without
    // the trim, "   " is a reason.
    expect(
      denyDomainInput.parse({ domain: "spam.example", reason: "  spam  " })
        .reason,
    ).toBe("spam");
    expect(
      denyDomainInput.safeParse({
        domain: "spam.example",
        reason: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
});

describe("a /takedown request on the wire (design 136)", () => {
  const request = {
    email: "sam@example.com",
    signature: "Sam Runner",
    location: "https://dialed.run/feed/entry/x",
    description: "",
    isAttested: true,
    idempotencyKey: newUlid(),
  };

  it("carries the form and Turnstile's answer, up to its length", () => {
    expect(
      takedownRequestInput.parse({ ...request, turnstileToken: "t" }),
    ).toStrictEqual({ ...request, turnstileToken: "t" });
    expect(takedownRequestInput.parse(request)).toStrictEqual(request);
    expect(
      takedownRequestInput.safeParse({
        ...request,
        turnstileToken: "t".repeat(2048),
      }).success,
    ).toBe(true);
    expect(
      takedownRequestInput.safeParse({
        ...request,
        turnstileToken: "t".repeat(2049),
      }).success,
    ).toBe(false);
  });

  it("refuses what the form would", () => {
    expect(
      takedownRequestInput.safeParse({ ...request, isAttested: false }).success,
    ).toBe(false);
  });
});

describe("an operator's decision on a request (design 136)", () => {
  const requestId = newUlid();

  it("takes a removal with no reason, and keeps none it is sent", () => {
    expect(
      removalDecisionInput.parse({ requestId, outcome: "removed" }),
    ).toStrictEqual({ requestId, outcome: "removed" });
    expect(
      removalDecisionInput.parse({
        requestId,
        outcome: "removed",
        reason: "ignored",
      }),
    ).toStrictEqual({ requestId, outcome: "removed" });
  });

  it("takes a decline only with a reason, trimmed", () => {
    expect(
      removalDecisionInput.parse({
        requestId,
        outcome: "declined",
        reason: "  shoes ",
      }),
    ).toStrictEqual({ requestId, outcome: "declined", reason: "shoes" });
    expect(
      removalDecisionInput.safeParse({ requestId, outcome: "declined" })
        .success,
    ).toBe(false);
  });

  it("refuses an outcome it does not know, or no request", () => {
    expect(
      removalDecisionInput.safeParse({ requestId, outcome: "maybe" }).success,
    ).toBe(false);
    expect(removalDecisionInput.safeParse({ outcome: "removed" }).success).toBe(
      false,
    );
    expect(
      removalDecisionInput.safeParse({ requestId: "x", outcome: "removed" })
        .success,
    ).toBe(false);
  });
});

function reasonMessages(reason: string): string[] | undefined {
  return declineReasonField
    .safeParse(reason)
    .error?.issues.map((issue) => issue.message);
}

describe("a decline's reason", () => {
  const messages = reasonMessages;

  it("asks for one, a blank one included", () => {
    expect(messages("")).toStrictEqual(["Say why, for the person who asked."]);
    expect(messages(" ".repeat(3))).toStrictEqual([
      "Say why, for the person who asked.",
    ]);
  });

  it("takes 500 characters and refuses 501", () => {
    expect(messages("a".repeat(500))).toBeUndefined();
    expect(messages("a".repeat(501))).toStrictEqual([
      "Keep it under 500 characters.",
    ]);
  });
});

describe("the run a page asks the removals of (R-140)", () => {
  it("takes the id of a run that does not exist, so the page can say so", () => {
    // `/runs/abc` is malformed and must reach `runOrNotFound`, not die here
    // in the loader's Promise.all beside it.
    expect(runRemovalsInput.parse({ runId: "abc" })).toStrictEqual({
      runId: "abc",
    });
  });

  it("refuses no id, and a `since` that is no time", () => {
    expect(runRemovalsInput.safeParse({ runId: "" }).success).toBe(false);
    expect(
      runRemovalsInput.safeParse({ runId: "abc", since: -1 }).success,
    ).toBe(false);
    expect(
      runRemovalsInput.safeParse({ runId: "abc", since: 1.5 }).success,
    ).toBe(false);
    expect(runRemovalsInput.parse({ runId: "abc", since: 7 }).since).toBe(7);
  });
});
