import { describe, expect, it } from "vitest";

import { visitorAddress } from "../../src/lib/visitor-address";

describe("visitorAddress", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(visitorAddress("203.0.113.9")).toBe("203.0.113.9");
  });

  it("keys every address in one IPv6 /64 the same", () => {
    expect(visitorAddress("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(
      visitorAddress("2001:db8:1:2:ffff:eeee:dddd:cccc".toUpperCase()),
    ).toBe("2001:db8:1:2::/64");
    expect(visitorAddress("2001:db8:001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(visitorAddress(" 2001:db8:1:2:a:b:c:d ")).toBe("2001:db8:1:2::/64");
  });

  it("keys two /64s apart", () => {
    expect(visitorAddress("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
  });

  it("fills a :: anywhere in the address", () => {
    expect(visitorAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    // A leading `::`: its network is all zeros, the same for both.
    expect(visitorAddress("::")).toBe(visitorAddress("::1"));
    expect(visitorAddress("::1")).toMatch(/^0:0:0:0::\/64$/u);
    expect(visitorAddress("2001:db8:1:2:3:4:5::")).toBe("2001:db8:1:2::/64");
    expect(visitorAddress("2001:db8:1::5:6:7:8")).toBe("2001:db8:1:0::/64");
  });

  it("keeps text that is not an IPv6 address, lowercased", () => {
    for (const text of [
      "unknown",
      "1::2::3",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4::5:6:7:8",
      "12345::1",
      "g::1",
      "2001:db8::192.0.2.1",
      "Not-An-Address",
    ]) {
      expect(visitorAddress(text)).toBe(text.toLowerCase());
    }
  });
});
