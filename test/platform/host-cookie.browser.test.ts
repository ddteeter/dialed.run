import { afterEach, describe, expect, it } from "vitest";

import { AGE_REFUSED_COOKIE } from "../../src/lib/contracts/age";

/**
 * What Chromium does with a `__Host-` cookie, the prefix every cookie the
 * app sets is named with (SA-M35, SA-L17; designs 230 and 227): it keeps
 * one only as the page's own host set it, `Secure`, at `Path=/` and with
 * no `Domain`. So a request carries one cookie of such a name, the app's.
 *
 * In the `browser` project because the rule is the browser's. The server
 * tests pin the names and the `Set-Cookie` lines the app writes; only a
 * browser shows which of them it keeps. The page here is on
 * `http://localhost`, as local dev and the e2e suite are, so the first
 * test is also what those rest on (design 239).
 */
const HOST_ONLY = AGE_REFUSED_COOKIE;
const SECURE_ONLY = "__Secure-platform-probe";
const BARE = "platform-probe";

/**
 * The cookies a script on `page` reads, by name.
 */
function held(page: Document = document): readonly string[] {
  return page.cookie
    .split("; ")
    .map((pair) => pair.slice(0, pair.indexOf("=")));
}

/**
 * A document of this origin below `/`, which is what a cookie's `Path` is
 * matched against: a static file the project serves, framed.
 */
const DEEP_PATH = "/strava";

async function deepDocument(): Promise<Document> {
  const frame = document.createElement("iframe");
  frame.src = `${DEEP_PATH}/NOTICE.txt`;
  const loaded = new Promise((resolve) => {
    frame.addEventListener("load", resolve, { once: true });
  });
  // `insertAdjacentElement` because the Workers types' `Element.append`
  // (HTMLRewriter's) shadows the DOM's for tsc.
  document.body.insertAdjacentElement("beforeend", frame);
  await loaded;
  if (frame.contentDocument === null) throw new Error("the frame is not ours");
  return frame.contentDocument;
}

afterEach(() => {
  for (const name of [HOST_ONLY, SECURE_ONLY, BARE]) {
    for (const scope of [
      "Path=/",
      `Path=${DEEP_PATH}`,
      "Path=/; Domain=localhost",
    ]) {
      document.cookie = `${name}=; Max-Age=0; Secure; ${scope}`;
    }
  }
  for (const frame of document.querySelectorAll("iframe")) frame.remove();
});

describe("a __Host- cookie in Chromium", () => {
  it("is kept from http://localhost when it is Secure, at Path=/ and names no Domain", () => {
    expect(location.protocol).toBe("http:");
    expect(location.hostname).toBe("localhost");

    document.cookie = `${HOST_ONLY}=1; Secure; Path=/; SameSite=Lax`;

    expect(held()).toContain(HOST_ONLY);
  });

  it("is dropped when it names a Domain, which a __Secure- cookie may", () => {
    document.cookie = `${HOST_ONLY}=1; Secure; Path=/; Domain=localhost`;
    document.cookie = `${SECURE_ONLY}=1; Secure; Path=/; Domain=localhost`;

    expect(held()).not.toContain(HOST_ONLY);
    expect(held()).toContain(SECURE_ONLY);
  });

  it("is dropped without Secure, which a bare name is not", () => {
    document.cookie = `${HOST_ONLY}=1; Path=/`;
    document.cookie = `${BARE}=1; Path=/`;

    expect(held()).not.toContain(HOST_ONLY);
    expect(held()).toContain(BARE);
  });

  it("is dropped at a longer Path, where a bare name is kept", async () => {
    const deep = await deepDocument();
    expect(deep.location.pathname.startsWith(`${DEEP_PATH}/`)).toBe(true);

    deep.cookie = `${HOST_ONLY}=1; Secure; Path=${DEEP_PATH}`;
    deep.cookie = `${BARE}=1; Secure; Path=${DEEP_PATH}`;

    expect(held(deep)).not.toContain(HOST_ONLY);
    expect(held(deep)).toContain(BARE);
  });
});
