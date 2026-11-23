import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { accessAsks, rateLimits } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { ACCESS_NOTE_MAX } from "../../src/lib/contracts/access";
import { receiveAccessRequest } from "../../src/modules/account";
import type { AccessEndpointDeps } from "../../src/modules/account/access/access-endpoint";
import type { TurnstileAttempt, TurnstileVerdict } from "../../src/modules/ops";
import { fakeMail } from "../email/helpers";

/**
 * `POST /api/access-requests` (round 31, design 187) on real D1: the form
 * in, the 303 out, and the row `requestAccess` left behind.
 */
const db = drizzle(env.DIALED_CORE);

const ENDPOINT = "https://app.dialed.run/api/access-requests";
const SENT = "https://dialed.run/invite/sent";
const VISITOR = "203.0.113.7";

beforeEach(async () => {
  await db.batch([db.delete(accessAsks), db.delete(rateLimits)]);
});

function verifyAs(isOk: boolean) {
  const seen: TurnstileAttempt[] = [];
  const verify = (attempt: TurnstileAttempt): Promise<TurnstileVerdict> => {
    seen.push(attempt);
    return Promise.resolve(
      isOk ? { ok: true } : { ok: false, reason: "rejected", codes: [] },
    );
  };
  return { seen, verify };
}

/**
The fake sender every endpoint test's confirm links go to.
*/
const mail = fakeMail();
const sending: Promise<unknown>[] = [];

beforeEach(() => {
  mail.sent.length = 0;
  sending.length = 0;
});

function depsWith(
  verify: AccessEndpointDeps["verify"],
  isLimited = false,
): AccessEndpointDeps {
  return {
    db,
    verify,
    isLimited,
    mail: {
      deps: mail,
      background: {
        keepAlive: (work) => {
          sending.push(work);
        },
        report: () => {
          // these sends succeed, so there is nothing to report
        },
      },
    },
  };
}

function post(
  fields: Record<string, string | Blob>,
  cf: Readonly<{ country?: string; regionCode?: string }> = {},
): Request {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return new Request(ENDPOINT, {
    method: "POST",
    body,
    headers: { "cf-connecting-ip": VISITOR },
    cf,
  });
}

function expectSeeOther(response: Response, location: string): void {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(location);
}

/**
The asks kept, each waiting on the link it sent.
*/
async function requests() {
  return db
    .select({
      email: accessAsks.email,
      note: accessAsks.note,
      confirmedAt: accessAsks.confirmedAt,
      blockedRegion: accessAsks.blockedRegion,
    })
    .from(accessAsks);
}

describe("receiveAccessRequest", () => {
  it("keeps the ask, sends its address the confirm link, and sends the visitor to /invite/sent", async () => {
    const { seen, verify } = verifyAs(true);
    const response = await receiveAccessRequest(
      post({
        email: "Sam@X.test",
        note: "Running club",
        "cf-turnstile-response": "token-1",
      }),
      depsWith(verify),
    );

    expectSeeOther(response, SENT);
    expect(await response.text()).toBe("");
    // The challenge was solved on the marketing site, so that is the host
    // it must name; the visitor's address comes off Cloudflare's header.
    expect(seen).toStrictEqual([
      {
        token: "token-1",
        remoteIp: VISITOR,
        hostname: "dialed.run",
        // The marketing form's action is not named here (SA-L07).
        action: undefined,
      },
    ]);
    const rows = await requests();
    expect(rows).toMatchObject([{ email: "sam@x.test", note: "Running club" }]);
    expect(rows[0]?.blockedRegion).toBeNull();
    expect(rows[0]?.confirmedAt).toBeNull();
    await Promise.all(sending);
    expect(mail.sent.map((message) => message.to)).toStrictEqual([
      "sam@x.test",
    ]);
  });

  it("takes a request with no note, as M5 sends it", async () => {
    const { verify } = verifyAs(true);
    const response = await receiveAccessRequest(
      post({ email: "sam@x.test", "cf-turnstile-response": "t" }),
      depsWith(verify),
    );
    expectSeeOther(response, SENT);
    const rows = await requests();
    expect(rows).toMatchObject([{ email: "sam@x.test" }]);
    expect(rows[0]?.note).toBeNull();
  });

  it("gives a repeat the same answer, each its own ask (the same-answer rule)", async () => {
    const { verify } = verifyAs(true);
    const ask = () =>
      receiveAccessRequest(
        post({ email: "sam@x.test", "cf-turnstile-response": "t" }),
        depsWith(verify),
      );
    expectSeeOther(await ask(), SENT);
    expectSeeOther(await ask(), SENT);
    expect(await requests()).toHaveLength(2);
  });

  it("answers error=turnstile when the challenge is refused, and keeps nothing", async () => {
    const { seen, verify } = verifyAs(false);
    const response = await receiveAccessRequest(
      post({ email: "sam@x.test" }),
      depsWith(verify),
    );
    expectSeeOther(response, "https://dialed.run/invite?error=turnstile");
    expect(seen).toStrictEqual([
      {
        token: undefined,
        remoteIp: VISITOR,
        hostname: "dialed.run",
        action: undefined,
      },
    ]);
    expect(await requests()).toStrictEqual([]);
  });

  it("answers error=rate_limited past the visitor's limit on a real deployment", async () => {
    const { verify } = verifyAs(true);
    const ask = (n: number) =>
      receiveAccessRequest(
        post({ email: `${String(n)}@x.test`, "cf-turnstile-response": "t" }),
        depsWith(verify, true),
      );
    for (const n of [1, 2, 3, 4, 5]) expectSeeOther(await ask(n), SENT);
    expectSeeOther(
      await ask(6),
      "https://dialed.run/invite?error=rate_limited",
    );
    expect(await requests()).toHaveLength(5);
  });

  it("takes a request from a blocked state, tagged, with the same receipt (Round 51 · 154.1)", async () => {
    const { verify } = verifyAs(true);
    const response = await receiveAccessRequest(
      post(
        { email: "sam@x.test", "cf-turnstile-response": "t" },
        { country: "US", regionCode: "TN" },
      ),
      depsWith(verify),
    );
    expectSeeOther(response, SENT);
    expect(await requests()).toMatchObject([
      { email: "sam@x.test", blockedRegion: "TN" },
    ]);
  });

  it.each([
    ["no address", {}],
    ["an empty address", { email: "" }],
    ["something that isn't an address", { email: "sam" }],
    // Round 51 · 154.2: invalid_email stays the email's, whatever the note.
    [
      "a bad address beside a note over the cap",
      { email: "sam", note: "n".repeat(ACCESS_NOTE_MAX + 1) },
    ],
    ["a file for the address", { email: new Blob(["sam@x.test"]) }],
    ["a file for the note", { email: "sam@x.test", note: new Blob(["n"]) }],
  ])(
    "answers error=invalid_email for %s, without asking Turnstile",
    async (_, fields) => {
      const { seen, verify } = verifyAs(true);
      const response = await receiveAccessRequest(
        post({ ...fields, "cf-turnstile-response": "t" }),
        depsWith(verify),
      );
      expectSeeOther(response, "https://dialed.run/invite?error=invalid_email");
      expect(seen).toStrictEqual([]);
      expect(await requests()).toStrictEqual([]);
    },
  );

  it("answers error=note_too_long for a good address and a note over the cap (Round 51 · 154.2)", async () => {
    const { seen, verify } = verifyAs(true);
    const response = await receiveAccessRequest(
      post({
        email: "sam@x.test",
        note: "n".repeat(ACCESS_NOTE_MAX + 1),
        "cf-turnstile-response": "t",
      }),
      depsWith(verify),
    );
    expectSeeOther(response, "https://dialed.run/invite?error=note_too_long");
    expect(seen).toStrictEqual([]);
    expect(await requests()).toStrictEqual([]);
  });

  it("answers error=invalid_email for a body that isn't a form", async () => {
    const { seen, verify } = verifyAs(true);
    const response = await receiveAccessRequest(
      new Request(ENDPOINT, {
        method: "POST",
        body: JSON.stringify({ email: "sam@x.test" }),
        headers: { "content-type": "application/json" },
      }),
      depsWith(verify),
    );
    expectSeeOther(response, "https://dialed.run/invite?error=invalid_email");
    expect(seen).toStrictEqual([]);
  });

  it("takes a note at exactly the cap", async () => {
    const { verify } = verifyAs(true);
    const note = "n".repeat(ACCESS_NOTE_MAX);
    expectSeeOther(
      await receiveAccessRequest(
        post({ email: "sam@x.test", note, "cf-turnstile-response": "t" }),
        depsWith(verify),
      ),
      SENT,
    );
    expect(await requests()).toMatchObject([{ note }]);
  });
});
