import { describe, expect, it } from "vitest";

import type { CallRequest, Scorer } from "../../../src/modules/call/contract";
import { measure, replay } from "../../../src/modules/call/replay";
import { replayCase, request, result, scored } from "./fixtures";

const fixedKit: Scorer = () => ({
  ...result(scored("a-tee", "shorts")),
  ranking: scored("z-base", "tights", "a-tee", "shorts"),
});
const ranksTheWornFirst: Scorer = () => ({
  ...result(scored("z-base", "tights")),
  ranking: scored("a-tee", "shorts", "z-base", "tights"),
});
describe("replay", () => {
  it("asks the scorer once per case, with that case's request", () => {
    const seen: CallRequest[] = [];
    const scorer: Scorer = (asked) => {
      seen.push(asked);
      return result(scored("a-tee"));
    };
    const first = replayCase(["a-tee"], 0, {
      caseId: "first",
      request: request({ hourStart: 1 }),
    });
    const second = replayCase(["a-tee"], 1, {
      caseId: "second",
      request: request({ hourStart: 2 }),
    });
    const outcomes = replay(scorer, [first, second]);
    expect(seen.map((r) => r.hourStart)).toEqual([1, 2]);
    expect(outcomes).toEqual([
      { replayCase: first, result: result(scored("a-tee")) },
      { replayCase: second, result: result(scored("a-tee")) },
    ]);
  });

  it("measures the kit, not the ranking order", () => {
    const cases = [replayCase(["a-tee", "shorts"], 0)];
    expect(measure(replay(fixedKit, cases)).dialedAgreement).toEqual({
      hits: 2,
      of: 2,
    });
    expect(measure(replay(ranksTheWornFirst, cases)).dialedAgreement).toEqual({
      hits: 0,
      of: 2,
    });
  });
});
