/**
 * `POST /api/access-requests` (round 31, design 187, #367): the marketing
 * site's M5 form, posted cross-site to the app host. Public stays
 * invite-only (D-173), so this is the public way in.
 *
 * The request goes through `requestAccess`, the same call Au5 makes.
 * Turnstile, the per-visitor limit, the region gate (design 144) and the
 * same-answer rule are all its, so this file adds no rule of its own. It
 * reads a form, names the host the challenge was solved on, and turns
 * `requestAccess`'s answer into one of round 31's 303s.
 */
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { requestAccessSchema } from "../../lib/contracts";
import { blockedRegionOf } from "../../lib/contracts/access";
import { MARKETING_HOST, MARKETING_INVITE_URL } from "../../lib/marketing";
import type { TurnstileAttempt, TurnstileVerdict } from "../ops";
import { requestAccess, turnstileAttempt } from "./access";

type Db = ReturnType<typeof drizzle>;

/**
 * M5's fields, form-encoded. The note is optional on the wire because M5
 * draws email alone, and round 31 leaves sending it to the marketing repo.
 * The token is Turnstile's own field name.
 */
const formSchema = requestAccessSchema.extend({
  note: requestAccessSchema.shape.note.default(""),
  "cf-turnstile-response": z.string().optional(),
});

/**
 * Round 31's error codes, which the marketing site's `/invite` draws.
 */
type InviteError = "turnstile" | "invalid_email" | "rate_limited";

export interface AccessEndpointDeps {
  /**
  The primary: its abuse limit gates the write (D-123, design 143).
  */
  readonly db: Db;
  readonly verify: (attempt: TurnstileAttempt) => Promise<TurnstileVerdict>;
  readonly isLimited: boolean;
}

function seeOther(location: string): Response {
  return new Response(undefined, { status: 303, headers: { location } });
}

function inviteError(code: InviteError): Response {
  return seeOther(`${MARKETING_INVITE_URL}?error=${code}`);
}

/**
 * The body as M5's fields, or nothing. A body that isn't a form, a field
 * that's a file, and an address or note that fails Au5's own schema all
 * read the same way.
 */
async function formOf(
  request: Request,
): Promise<z.infer<typeof formSchema> | undefined> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return undefined;
  }
  return formSchema.safeParse(Object.fromEntries(form)).data;
}

export async function receiveAccessRequest(
  request: Request,
  deps: AccessEndpointDeps,
): Promise<Response> {
  const form = await formOf(request);
  // Design 154 (#528) part 2, a guess: a note over the cap answers
  // invalid_email too, because that is round 31's only field error and M5
  // draws email alone.
  if (form === undefined) return inviteError("invalid_email");
  const result = await requestAccess(
    deps.db,
    {
      email: form.email,
      note: form.note,
      // The challenge is solved on the marketing site and posted here, so
      // the host it must name is the marketing site's, not this request's.
      attempt: {
        ...turnstileAttempt(form["cf-turnstile-response"], request),
        hostname: MARKETING_HOST,
      },
      isLimited: deps.isLimited,
      blockedRegion: blockedRegionOf(request),
    },
    deps.verify,
  );
  switch (result.status) {
    // Design 154 (#528) part 1, a guess: a request from a blocked state is
    // taken and gets the same receipt. Round 31 has no code for it, and the
    // waitlist copy is the marketing site's to show.
    case "received": {
      return seeOther(`${MARKETING_INVITE_URL}/sent`);
    }
    case "refused": {
      return inviteError("turnstile");
    }
    case "limited": {
      return inviteError("rate_limited");
    }
  }
}
