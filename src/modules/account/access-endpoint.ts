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
 * The error codes the marketing site's `/invite` draws: round 31's three,
 * and Round 51 · 154.2's `note_too_long`, with which `/invite` keeps both
 * fields and says "Keep it under {cap} characters." under the note.
 */
type InviteError =
  "turnstile" | "invalid_email" | "note_too_long" | "rate_limited";

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
 * The body as M5's fields, or the code that says why not. Only a note over
 * the cap beside an address that parses is `note_too_long` (Round 51 ·
 * 154.2); a body that isn't a form, a field that's a file and an address
 * that fails Au5's own schema are all `invalid_email`, which stays the
 * email's alone.
 */
async function formOf(
  request: Request,
): Promise<z.infer<typeof formSchema> | InviteError> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return "invalid_email";
  }
  const parsed = formSchema.safeParse(Object.fromEntries(form));
  if (parsed.success) return parsed.data;
  return parsed.error.issues.every((issue) => isNoteTooLong(issue))
    ? "note_too_long"
    : "invalid_email";
}

/**
 * An issue that is a field over its cap. The note is the only field with
 * one, so with every issue this kind the address parsed and the note is
 * too long; a note that's a file is `invalid_type`, not this.
 */
function isNoteTooLong(issue: z.core.$ZodIssue): boolean {
  return issue.code === "too_big";
}

export async function receiveAccessRequest(
  request: Request,
  deps: AccessEndpointDeps,
): Promise<Response> {
  const form = await formOf(request);
  if (typeof form === "string") return inviteError(form);
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
    // Round 51 · 154.1 (#528): a request from a blocked state is taken
    // and gets the same receipt, so the answer doesn't reveal the gate.
    // The sent page's copy reads true either way ("Request sent." / "We
    // hand out invites in small batches. If one comes your way, it'll
    // arrive at {email}."); it is the marketing site's to show.
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
