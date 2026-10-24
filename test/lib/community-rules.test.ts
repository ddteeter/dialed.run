import { describe, expect, it } from "vitest";

import terms from "../../docs/legal/terms.md?raw";
import {
  communityRuleKeys,
  communityRules,
  communityRuleSchema,
  decidedBy,
  REDRESS_FOOT,
  ruleLine,
} from "../../src/lib/contracts/community-rules";
import {
  closureRuleLabels,
  closureRuleOf,
  closureRules,
  closureRuleSchema,
  removalReasons,
  removalRule,
  removalRuleLine,
  removalRuleOf,
} from "../../src/modules/safety/contracts";

/**
 * C8 (D-145): the rules a statement of reasons names are the terms' own,
 * so the table is pinned to `terms.md` in both directions.
 */

/**
The bullets of the terms' "The rules", each as written.
*/
function termsRules(): string[] {
  const section = terms.split("## The rules", 2)[1]?.split("\n## ", 1)[0] ?? "";
  return section
    .split("\n")
    .filter((line) => line.startsWith("- **"))
    .map((line) => line.slice("- **".length));
}

describe("the community rules (C8)", () => {
  it("names each rule as the terms bold it, in the terms' order", () => {
    const bullets = termsRules();
    expect(bullets).toHaveLength(communityRuleKeys.length);
    for (const [index, key] of communityRuleKeys.entries()) {
      expect(bullets[index]?.startsWith(communityRules[key])).toBe(true);
      // The bold ends where the name does.
      expect(bullets[index]?.slice(communityRules[key].length)).toMatch(
        /^\.?\*\*/u,
      );
    }
  });

  it("parses only a rule's key", () => {
    expect(communityRuleSchema.parse("home")).toBe("home");
    expect(
      communityRuleSchema.safeParse("Show where someone lives").success,
    ).toBe(false);
  });

  it("says the rule after don't, lower-cased", () => {
    expect(ruleLine("home")).toBe(
      "That breaks our community rules: don't show where someone lives.",
    );
    expect(ruleLine("banEvasion")).toBe(
      "That breaks our community rules: don't make another account.",
    );
  });

  it("says who decided, in the owner's words", () => {
    expect(decidedBy(false)).toBe("A person made this decision.");
    expect(decidedBy(true)).toBe(
      "Our automatic check flagged it; a person made the decision.",
    );
    expect(REDRESS_FOOT).toBe(
      "Think we got it wrong? Reply to this email and a person will look again. You can also take it to a court.",
    );
  });
});

describe("the rule a removal names", () => {
  it("maps every reason the Desk offers, and only the catch-all to none", () => {
    expect(Object.keys(removalRule)).toStrictEqual(removalReasons);
    expect(removalRule).toStrictEqual({
      home: "home",
      explicit: "explicit",
      intimate: "explicit",
      harassment: "harassment",
      spam: "spam",
      copyright: "othersWork",
      rules: undefined,
    });
  });

  it("names none after a copyright notice, and the rule after a Remove", () => {
    expect(removalRuleOf("takedown", "copyright")).toBeUndefined();
    expect(removalRuleOf("remove", "copyright")).toBe("othersWork");
    expect(removalRuleOf("takedown", "intimate")).toBe("explicit");
    expect(removalRuleLine("takedown", "copyright")).toBeUndefined();
    expect(removalRuleLine("remove", "rules")).toBeUndefined();
    expect(removalRuleLine("remove", "home")).toBe(ruleLine("home"));
  });
});

describe("the rule a closure names", () => {
  it("offers every rule, then suspected CSAM, which names none", () => {
    expect(closureRules).toStrictEqual([
      ...communityRuleKeys,
      "suspected_csam",
    ]);
    expect(closureRuleOf("suspected_csam")).toBeUndefined();
    expect(closureRuleOf("harassment")).toBe("harassment");
    expect(closureRuleLabels).toStrictEqual({
      ...communityRules,
      suspected_csam: "Suspected CSAM: name no rule",
    });
    expect(
      closureRuleSchema.safeParse(undefined).error?.issues[0]?.message,
    ).toBe("Pick the rule it breaks.");
  });
});
