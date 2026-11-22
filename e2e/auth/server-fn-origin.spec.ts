import { createServer } from "node:http";
import type { Server } from "node:http";

import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Response,
} from "@playwright/test";

import { newUlid } from "../../src/lib/ids";
import { expect, test } from "../support/a11y";
import { storageStateFor } from "../support/accounts";
import { isServerFnCall } from "../support/server-fn";

/**
 * Covers: a server function answers only this app's own pages, of every
 * method, and a payload carries data, never a server function (SA-M1,
 * SA-M25, design 230).
 *
 * A Playwright spec because only the running Worker shows it: the check is
 * TanStack Start's own middleware, listed in `src/start.ts`, which no test
 * can import. `test/architecture/server-fn-request-check.test.ts` pins the
 * wiring; this pins what a request meets.
 *
 * The first half sets `Sec-Fetch-Site` by hand, through Playwright's own
 * client. The second asks from pages on other origins in the browser
 * itself, because the check rests on what Chromium says of where a
 * request began, which no header a test sets can stand in for (design
 * 239): a page's script cannot choose it, and a link's navigation carries
 * it too.
 */
test.use({ storageState: storageStateFor("closet") });

/**
 * A payload whose one node names a server function, as the framework's
 * own adapter would decode it into a callable.
 */
const SERVER_FN_NODE = JSON.stringify({
  t: {
    t: 25,
    i: 0,
    c: "$TSR/t/$TSS/serverfn",
    s: {
      v: {
        t: 10,
        i: 1,
        o: 0,
        p: { k: ["functionId"], v: [{ t: 1, s: "any-id" }] },
      },
    },
  },
  f: 63,
  m: [],
});

async function statusOfGet(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string> = {},
): Promise<number> {
  const response = await request.get(url, { headers });
  return response.status();
}

async function statusOfPost(
  request: APIRequestContext,
  url: string,
  site: string,
): Promise<number> {
  const response = await request.post(url, {
    headers: {
      "sec-fetch-site": site,
      "content-type": "text/plain; application/json",
    },
    data: "{}",
  });
  return response.status();
}

/**
 * Another origin, served for real on a port of its own: one page with one
 * link, at whatever host name reaches it. Not drawn by the test
 * (`route.fulfill`), because Chromium asks permission before a page it
 * cannot place reaches a local address, and a drawn page is one.
 */
async function serveElsewhere(link: string): Promise<Server> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<title>elsewhere</title><a href="${link}">to the app</a>`);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the page's server has no port");
  }
  return address.port;
}

/**
 * What Chromium put on the wire for a request, by method and address.
 */
type Sent = (request: string) => ReadonlyMap<string, string> | undefined;

/**
 * A page on another origin, and what it sends. What it asks of the app is
 * the browser's own request, with the cookies and the `Sec-Fetch-Site`
 * Chromium decides on, so those are read from the browser's own protocol:
 * Playwright's `allHeaders()` leaves both out of a request whose answer
 * the page may not read, which is every one here.
 */
async function pageOn(
  context: BrowserContext,
  origin: string,
): Promise<{ elsewhere: Page; sent: Sent }> {
  const elsewhere = await context.newPage();
  await elsewhere.goto(`${origin}/`);
  const browser = await context.newCDPSession(elsewhere);
  await browser.send("Network.enable");
  const idOf = new Map<string, string>();
  const headersOf = new Map<string, ReadonlyMap<string, string>>();
  browser.on("Network.requestWillBeSent", (event) => {
    idOf.set(`${event.request.method} ${event.request.url}`, event.requestId);
  });
  browser.on("Network.requestWillBeSentExtraInfo", (event) => {
    headersOf.set(
      event.requestId,
      new Map(
        Object.entries(event.headers).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      ),
    );
  });
  return {
    elsewhere,
    sent: (request) => headersOf.get(idOf.get(request) ?? ""),
  };
}

/**
 * What the app answered, and what the browser sent to be answered.
 */
interface Met {
  status: number;
  site: string | undefined;
  contentType: string | undefined;
  hasSession: boolean;
}

async function met(response: Response, sent: Sent): Promise<Met> {
  const request = `${response.request().method()} ${response.url()}`;
  await expect.poll(() => sent(request)).toBeDefined();
  const headers = sent(request);
  return {
    status: response.status(),
    site: headers?.get("sec-fetch-site"),
    contentType: headers?.get("content-type"),
    hasSession: (headers?.get("cookie") ?? "").includes("session_token="),
  };
}

/**
 * The app's own client's POST, as a script on another origin can send
 * it: the browser's cookies, a content type it sends without asking the
 * app first, and a `Sec-Fetch-Site` of the script's choosing.
 */
async function postFrom(
  { elsewhere, sent }: { elsewhere: Page; sent: Sent },
  url: string,
): Promise<Met> {
  const answered = elsewhere.waitForResponse(
    (response) =>
      response.url() === url && response.request().method() === "POST",
  );
  await elsewhere.evaluate(async (target) => {
    await fetch(target, {
      method: "POST",
      mode: "no-cors",
      credentials: "include",
      headers: {
        "content-type": "text/plain; application/json",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    });
  }, url);
  return met(await answered, sent);
}

/**
 * The page's one link, followed: a navigation another origin started.
 */
async function followLinkFrom(
  { elsewhere, sent }: { elsewhere: Page; sent: Sent },
  url: string,
): Promise<Met> {
  const answered = elsewhere.waitForResponse(
    (response) => response.url() === url,
  );
  await elsewhere.getByRole("link").click();
  return met(await answered, sent);
}

test("a server function answers only this app's own pages", async ({
  page,
  context,
}) => {
  // A GET server function's address, from the app's own traffic: the
  // bell page's loader, run in the browser after a client-side navigation.
  // Before hydration the link is a plain one and the page loads whole.
  await page.goto("/closet");
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  const sent = page.waitForRequest(
    (request) =>
      request.url().includes("/_serverFn/") && request.method() === "GET",
  );
  await page.getByRole("link", { name: "Notifications" }).first().click();
  const call = await sent;
  const own = call.url();
  const sameOrigin = { "sec-fetch-site": "same-origin" };

  // The app's own call is answered.
  expect(await statusOfGet(page.request, own, sameOrigin)).toBe(200);

  // Another site, or another host under this domain, is refused on GET
  // and on POST, before the method or the payload is read.
  for (const site of ["cross-site", "same-site"]) {
    expect(
      await statusOfGet(page.request, own, { "sec-fetch-site": site }),
    ).toBe(403);
    expect(await statusOfPost(page.request, own, site)).toBe(403);
  }

  // With no fetch metadata, a foreign Origin is refused, as is a request
  // that says nothing of where it came from.
  expect(
    await statusOfGet(page.request, own, {
      origin: "https://elsewhere.example",
    }),
  ).toBe(403);
  expect(await statusOfGet(page.request, own)).toBe(403);

  // A payload that names a server function is refused while it is read.
  const withServerFn = new URL(own);
  withServerFn.searchParams.set("payload", SERVER_FN_NODE);
  const refused = await page.request.get(withServerFn.href, {
    headers: sameOrigin,
  });
  expect(refused.status()).toBe(500);
  expect(await refused.text()).not.toContain("any-id");

  // An address no server function has is never answered as a call that
  // worked, which is what its timing line is named by (SA-L08,
  // `ops/speed/timing`'s `timedName`).
  const unregistered = new URL(`/_serverFn/${"a".repeat(64)}`, own);
  expect(await statusOfGet(page.request, unregistered.href, sameOrigin)).toBe(
    500,
  );

  // From the browser itself, from pages another server answers.
  const elsewhere = await serveElsewhere(own);
  try {
    const port = String(portOf(elsewhere));

    // Another origin on this host is the same site: Chromium sends the
    // session with the POST, says `same-site` whatever the script asked
    // for, and the call is refused.
    const sameSite = await pageOn(context, `http://localhost:${port}`);
    expect(await postFrom(sameSite, own)).toStrictEqual({
      status: 403,
      site: "same-site",
      contentType: "text/plain; application/json",
      hasSession: true,
    });

    // Another site: no session on a POST, and refused all the same. Its
    // link is a navigation, which does carry the session, and is refused.
    const otherSite = await pageOn(
      context,
      `http://elsewhere.localhost:${port}`,
    );
    expect(await postFrom(otherSite, own)).toStrictEqual({
      status: 403,
      site: "cross-site",
      contentType: "text/plain; application/json",
      hasSession: false,
    });
    expect(await followLinkFrom(otherSite, own)).toStrictEqual({
      status: 403,
      site: "cross-site",
      contentType: undefined,
      hasSession: true,
    });
  } finally {
    elsewhere.close();
  }
});

test("a server-function path with no function id is answered with a 404", async ({
  request,
}) => {
  for (const path of [
    "/_serverFn/",
    "/_serverFn//x",
    "/%5FserverFn/",
    "/_serverFn/%20",
  ]) {
    const response = await request.get(path, {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(response.status(), path).toBe(404);
    // The Worker's own answer: it carries the security headers.
    expect(response.headers()["x-content-type-options"], path).toBe("nosniff");
  }
});

/**
What a reply says that the edge would keep: its status, type, cache and body.
*/
async function storedShape(
  request: APIRequestContext,
  url: string,
  headers: Record<string, string>,
): Promise<{
  status: number;
  type: string | undefined;
  cache: string | undefined;
  body: string;
}> {
  const response = await request.get(url, { headers });
  return {
    status: response.status(),
    type: response.headers()["content-type"],
    cache: response.headers()["cache-control"],
    body: await response.text(),
  };
}

test("a public query answers the same with and without the framework's header", async ({
  page,
}) => {
  // The kit page's query, as the app's own client sends it: its loader,
  // run again in the browser once the page has hydrated.
  await page.goto(`/kit/${newUlid()}`);
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
  const sent = page.waitForRequest(
    (request) =>
      isServerFnCall(request.url(), "publicKitQuery") &&
      request.method() === "GET",
  );
  // The router TanStack puts on the page's window, as an expression the
  // page evaluates: a function handed to `evaluate` cannot name it.
  await page.evaluate("window.__TSR_ROUTER__.invalidate()");
  const call = await sent;
  expect(call.headers()["x-tsr-serverfn"]).toBe("true");

  const sameOrigin = { "sec-fetch-site": "same-origin" };
  const fromClient = await storedShape(page.request, call.url(), {
    ...sameOrigin,
    "x-tsr-serverfn": "true",
  });
  const bare = await storedShape(page.request, call.url(), sameOrigin);

  expect(fromClient.status).toBe(200);
  expect(fromClient.cache).toContain("public");
  expect(bare).toStrictEqual(fromClient);
});
