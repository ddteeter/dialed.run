import { describe, expect, it } from "vitest";

import { isFirstPartyRequest } from "../../src/lib/fetch-site";

/**
 * Whether the runner's own browsing caused a request (design 230), from
 * `Sec-Fetch-Site`.
 */
describe("isFirstPartyRequest", () => {
  it.each(["same-origin", "none"])("is %s, the runner's own", (site) => {
    expect(isFirstPartyRequest(new Headers({ "sec-fetch-site": site }))).toBe(
      true,
    );
  });

  it("is a request with no fetch metadata, which says nothing", () => {
    expect(isFirstPartyRequest(new Headers())).toBe(true);
  });

  it.each(["same-site", "cross-site", "", "Same-Origin", "unknown"])(
    "is not %j",
    (site) => {
      expect(
        isFirstPartyRequest(new Headers({ "sec-fetch-site": site })),
      ).toBe(false);
    },
  );
});
