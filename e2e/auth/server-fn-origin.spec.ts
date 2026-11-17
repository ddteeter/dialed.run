import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "../support/a11y";
import { storageStateFor } from "../support/accounts";

/**
 * Covers: a server function answers only this app's own pages, of every
 * method, and a payload carries data, never a server function (SA-M1,
 * SA-M25, design 230).
 *
 * A Playwright spec because only the running Worker shows it: the check is
 * TanStack Start's own middleware, listed in `src/start.ts`, which no test
 * can import. `test/architecture/server-fn-request-check.test.ts` pins the
 * wiring; this pins what a request meets.
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

test("a server function answers only this app's own pages", async ({
  page,
}) => {
  // A GET server function's address, from the app's own traffic: the
  // bell page's loader, run in the browser after a client-side navigation.
  await page.goto("/closet");
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
});
