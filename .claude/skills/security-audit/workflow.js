export const meta = {
  name: "security-audit",
  description:
    "Security audit of dialed.run at a pinned commit: read-only reviewers per area, an independent second pass on every finding, optional re-checks against changed libraries, and a coverage-gap check. Output goes only to the private home.",
  phases: [
    {
      title: "Review",
      detail:
        "one reviewer per brief; each writes a coverage note and one file per finding",
    },
    {
      title: "Version re-check",
      detail: "existing findings re-read against the locked library versions",
    },
    {
      title: "Second pass",
      detail: "an independent verifier tries to refute each new finding",
    },
    {
      title: "Gaps",
      detail: "coverage notes cross-checked against the source inventory",
    },
  ],
};

const A = args || {};
for (const k of ["sha", "pin", "libs", "out"]) {
  if (!A[k]) throw new Error(`args.${k} is required (SKILL.md, step 4)`);
}
const SHA = A.sha;
const PIN = A.pin;
const LIBS = A.libs;
const OUT = A.out;
const PREFIX = A.prefix || "";
const KNOWN = A.known === true;
const RECHECKS = A.rechecks || [];
const STALE = A.stale || null;
const CUT_OFF = A.cut_off || [];
if (RECHECKS.length && !(STALE && STALE.path && STALE.list))
  throw new Error("args.rechecks needs args.stale { path, list }");

// The first round's briefs: issue #693's ten areas, with authorisation split
// by module so no reviewer has more than about fifty server functions.
// SKILL.md step 2 says how to check the split and the start lists.
const AREAS = [
  {
    key: "01-auth-sessions",
    title: "Sign-up, sign-in and sessions",
    scope: `The invite, age, region and Turnstile gates on every path that can create an account (email and password, Google, any other Better Auth endpoint that can create a user, not only the sign-up form); password change and reset; email verification; session lifetime, revocation and cookie attributes, including every session endpoint Better Auth mounts; the ban and deletion gates (can a banned or deleted account still sign in, keep a session, or act?).`,
    start: `src/modules/auth/, src/modules/onboarding/, src/routes/api/auth/$.ts, src/routes/auth/, src/routes/join.tsx, src/env/, and Better Auth's own source for every endpoint the mounted handler exposes.`,
  },
  {
    key: "02a-authz-feed",
    title: "Authorisation: feed, notifications, products",
    scope: `Every server function in src/modules/feed/functions.ts, src/modules/notifications/functions.ts and src/modules/products/functions.ts (and the inputs and queries they call): does each check that the caller may read or change that row? Block and privacy rules on the feed, profiles, entry detail and search: an entry's audience is private, groups or runners, and strangers may see only runners entries; every check must read the audience. Blocks must hold in both directions on every read path, counts included.`,
    start: `src/modules/feed/, src/modules/notifications/, src/modules/products/, src/routes/feed/, src/routes/kit/, the profile route, src/routes/notifications/, src/lib/sql/. List every createServerFn in the three functions.ts files and account for each one by name in the coverage note.`,
  },
  {
    key: "02b-authz-account",
    title: "Authorisation: account, auth, email",
    scope: `Every server function in src/modules/account/functions.ts, src/modules/auth/functions.ts and src/modules/email/functions.ts (and what they call): does each check that the caller may read or change that row, and does a write others can see require a verified account? Settings, handle and profile changes, export requests, deletion requests, email preferences and unsubscribe.`,
    start: `src/modules/account/, src/modules/auth/, src/modules/email/, src/routes/account/, test/architecture/verification-class.test.ts. List every createServerFn in the three functions.ts files and account for each one by name in the coverage note.`,
  },
  {
    key: "02c-authz-runs-closet",
    title: "Authorisation: runs, closet, onboarding",
    scope: `Every server function in src/modules/runs/functions.ts, src/modules/closet/functions.ts and src/modules/onboarding/functions.ts (and what they call): does each check that the caller owns the garment, kit, entry, photo or import it reads or changes? Look for an id taken from input and used without an ownership predicate, including ids nested inside a payload (a kit that names someone else's garment, an entry that names someone else's photo key).`,
    start: `src/modules/runs/, src/modules/closet/, src/modules/onboarding/, src/lib/sql/owned.ts, src/routes/runs/, src/routes/closet/, src/routes/onboarding/, src/routes/call/. List every createServerFn in the three functions.ts files and account for each one by name in the coverage note.`,
  },
  {
    key: "02d-authz-desk-routes",
    title: "Authorisation: safety, the Desk, and server routes",
    scope: `Every server function in src/modules/safety/functions.ts and src/modules/ops/functions.ts: the Desk's operator gate on every Desk function (is it checked on the server, on every one, against the primary?), and the caller checks on reports, blocks and takedowns. For each Desk function, read what runs after the gate too: which ids come from the request, what is checked about each, and what one call can reach. Then every server route handler (a route file with a server or handlers block; find them with git grep): who may call each and what does it return to them? Also the createServerFn call sites outside the functions.ts files.`,
    start: `src/modules/safety/, src/modules/ops/, src/routes/desk/, src/routes/safety/, src/routes/takedown/, src/routes/api/. Account for every Desk function and every server route by name in the coverage note.`,
  },
  {
    key: "03-request-integrity",
    title: "Request integrity",
    scope: `Cross-site request protections on every state-changing entry point (server functions, server routes, the Better Auth handler): what stops another site from making a signed-in runner's browser perform a write? Origin and Referer checks, cookie SameSite attributes and what they do and do not cover, CORS headers and preflight handling, content types a cross-site form can send. And that no GET changes state, including GET server functions, link-driven routes (unsubscribe, export download, OAuth callbacks) and anything a prefetch or link scanner would trigger.`,
    start: `src/server.ts, src/start.ts, src/routes/api/, src/routes/account/, src/modules/auth/, public/_headers, and TanStack Start's server-function handler and Better Auth's origin handling in the library source. Establish from the library source exactly which HTTP methods, content types and headers a server-function call is accepted with.`,
  },
  {
    key: "04-input-output",
    title: "Input and output",
    scope: `Validation at every entry point (is every server function's input parsed by a schema, with bounded strings and arrays?); SQL only through the query builder or bound parameters (find every raw sql template, LIKE pattern and dynamic ORDER BY or column name); output encoding (dangerouslySetInnerHTML, inline scripts and JSON embedded in HTML, the OG image routes, email HTML, CSV or export output); redirects (every redirect whose target comes from the request, including return paths after sign-in); user-supplied links, both where they are shown (schemes, rel attributes) and where the server fetches them (which hosts can the server be made to request?). Read the components that render runner-typed or fetched data; a search for dangerous names is not enough.`,
    start: `src/modules/*/inputs.ts, src/modules/*/functions.ts, src/lib/ (the contracts, the sql helpers, the return-path and link helpers), src/modules/enrichment/, src/modules/email/, src/routes/og/, src/lib/browser/, src/ui/.`,
  },
  {
    key: "05-uploads-media",
    title: "Uploads and media",
    scope: `Photo and import uploads end to end: type and size checks (enforced on the server, on the bytes, not the declared type?), metadata stripping (where does it happen, and can an original with EXIF or location ever be stored or served?), quarantine and moderation state, who can fetch which object (key construction and guessability, ownership and audience checks on every photo route, what a blocked, signed-out or banned caller gets), and the content types and headers media is served with (can an upload be served as HTML or SVG from the app's origin? nosniff, Content-Disposition, caching of private media).`,
    start: `the photo and file-key helpers in src/lib/, every route that serves a photo (git grep for the R2 bindings' readers under src/routes/), the upload paths in src/modules/closet/, runs/, feed/, account/, safety/, and wrangler.jsonc for the R2 buckets.`,
  },
  {
    key: "06-third-party",
    title: "Third-party flows",
    scope: `Strava: the OAuth state parameter (bound to the session? single use? expiry?), the callback, token storage, and webhook verification (the subscription handshake and how an incoming event is authenticated; what can a forged event do?). Google sign-in: account linking by email, the verified-email assumption, and whether it can bypass a gate or take over an existing account. Any other connected service the same way. Outbound email: tokens in links (entropy, expiry, single use, what they authorise), whether a response or an email reveals that an address has an account, and whether user-controlled text can shape an email's headers or content. And for every outside service, the personal data it is sent.`,
    start: `src/routes/api/, the OAuth connect and callback routes under src/routes/runs/, src/modules/runs/ (the connected-service parts), src/modules/auth/ (Better Auth config, social providers), src/modules/email/, src/modules/notifications/, the unsubscribe and export routes under src/routes/account/.`,
  },
  {
    key: "07-abuse",
    title: "Abuse controls",
    scope: `Rate limits: which entry points have one, what key it uses (can the caller rotate the key?), where the counter lives and whether it holds under concurrency; which expensive or sensitive entry points have none. Invite-code guessing (code space, attempt limits, what a wrong code reveals). Account and email enumeration across sign-up, sign-in, reset, access requests and handle lookup. Anything a stranger or one runner can make cost money: outbound email, queue messages, R2 writes, D1 writes, image work, third-party API calls, OG image rendering, unbounded pagination or search. Go through every server function for this, not only the ones that look expensive, and every queue consumer and cron for what a runner's action can enqueue and how often it retries.`,
    start: `git grep for rate, limit, throttle and Turnstile in src/; every src/modules/*/functions.ts; src/routes/api/, src/routes/og/, src/modules/email/, src/modules/enrichment/, src/modules/weather/, the queue and cron handlers reached from src/server.ts, wrangler.jsonc.`,
  },
  {
    key: "08-platform",
    title: "Platform configuration",
    scope: `Bindings and secrets (wrangler.jsonc, src/env/: is any secret reachable from client code or a response? any default that is unsafe if the variable is unset?); response headers and the CSP (public/_headers, the nonce, what the policy allows, which responses miss the headers); cron and queue consumers and what they trust (is every queue message parsed? can a user-influenced message make a consumer act for another user?); personal data in logs and Sentry payloads; the health and vitals endpoints and what they reveal; feature flags; every wrangler.jsonc setting, and the dashboard-only state the config relies on.`,
    start: `wrangler.jsonc, public/_headers, src/server.ts, src/start.ts, src/env/, the CSP and error helpers in src/lib/, src/routes/__root.tsx, src/routes/api/, src/modules/ops/, every queue and cron handler reached from src/server.ts, and every Sentry call (git grep -i sentry src/).`,
  },
  {
    key: "09-data-lifecycle",
    title: "Data lifecycle",
    scope: `Export (who can request and download one, how the download token is made, its expiry, what the file contains, where it is stored and for how long); account deletion and purge (list every table and R2 prefix that holds a user's data from the schema, then check each is deleted or anonymised by the purge; what stays reachable between the request and the purge; sessions, OAuth tokens, queued jobs and emails after deletion; copies outside the tables such as logs and error reports); retention (reports, takedowns, moderation records, logs, quarantined photos); and what a deleted or banned user's content looks like to others afterwards (feed, counts, shared product rows, cached pages, OG images).`,
    start: `src/db/ (every schema file: build the table list first, and compare it with the migrations), src/modules/account/ (export, deletion, purge), the cron and queue handlers in src/server.ts, src/modules/safety/, docs/contracts.md for what retention is promised.`,
  },
  {
    key: "10-supply-chain",
    title: "Supply chain and CI",
    scope: `Every workflow in .github/workflows/: token permissions (top level and per job), triggers that run with secrets on untrusted code (pull_request_target, workflow_run, issue_comment), script injection through expressions interpolated into run steps, actions pinned to a full commit SHA or not, artifact and cache poisoning between untrusted and trusted runs, and what the Dependabot workflow may do. Dependencies: version pins and ranges in package.json, the lockfile, install scripts (which packages run one, and is that restricted?), .npmrc, Dependabot configuration and cooldown, any script fetched and run at install or build time, and scripts the page loads from other origins at run time. Tracked code outside src/ that handles keys or data (eval/, scripts/). The repo is public, so assume a stranger can open a PR from a fork.`,
    start: `.github/, package.json, package-lock.json, .npmrc, .githooks/, guardrails.config.json, scripts/, eval/, docs/dependencies.md, SECURITY.md.`,
  },
];

const BRIEFS = A.areas || AREAS;

const RULES = `
## Ground rules (all of them are hard limits)

- **The code under review is pinned.** Read it only from \`${PIN}\`, a detached worktree at commit \`${SHA}\`. Do not read app source from any other checkout or worktree. Cite every claim as a repo-relative \`path:line\` at that commit.
- **Read-only in the repo.** Do not create, edit or delete any file in the repository or any of its worktrees. No git command that changes state. No \`npm install\`, build, test run, Stryker, dev server, wrangler, Playwright or e2e run, and no script run with node. You read code and reason about it; read-only shell commands (grep, git grep, git show, diff, wc, jq on a file) are fine.
- **Libraries are read at the locked versions.** Read dependency source only from \`${LIBS}\`: a clean install of the pinned lockfile. Cite library lines as \`node_modules/<package>/<path>:line\`. The repo's own \`node_modules\` can be behind the lockfile, so do not cite it. When a claim depends on how a library behaves, read the library; do not assume either way, and say so plainly when you could not confirm it.
- **Write only inside \`${OUT}\`.** Do not list or read its parent directory. Scratch files go in \`${OUT}/scratch/\` and nowhere else.
- **Your read is independent.** Do not read files other reviewers wrote in \`${OUT}\`, except the ones this brief names.
- **Nothing leaves this machine.** No GitHub issue, comment, PR, commit or memory file may mention a finding. You may read public vendor documentation and the public source of a third-party package or action, but put no detail of this project or of any finding into a request. Copy no secret value into anything you write.
- Do the reading yourself; do not spawn subagents. Install nothing: if a tool would have helped, name it in your coverage note.
- If a write to \`${OUT}\` is refused, do not write elsewhere: return the file's full content in \`write_failures\`.
`;

const SEVERITY = `
## Severity

- **high**: a stranger or an ordinary signed-in runner can read or change another runner's private data, take over an account, get past the invite, age, region or ban gate, reach the operator's Desk, or run up unbounded cost. No unusual precondition.
- **medium**: real impact, but it needs a precondition (the victim has to act, a specific configuration, an operator mistake), or what is exposed is limited.
- **low**: hardening. A missing defence with no route to impact that you can show.

Rate what the code at the pinned commit allows, not what would be bad in theory. "Nobody has done it" is not a mitigation.
`;

const FINDING_FORMAT = `
## Finding files

One file per finding at \`${OUT}/findings/${PREFIX}<your key>-<short-slug>.md\`:

\`\`\`
# <title: what is wrong, in one line>

- Area: <your key>
- Severity (first pass): high | medium | low
- Commit: ${SHA}
- Status: unconfirmed

## What is wrong
## Where
(every path:line that matters, with the few lines of code quoted)
## What an attacker gains
(who the attacker is: stranger, signed-in runner, blocked runner, banned runner, another site in the victim's browser; and what they need)
## How it is reached
(the request or sequence, concretely enough that a second reader can check each step against the code)
## What you checked that does not stop it
(the gates, wrappers and library defaults you looked at, with path:line)
## Smallest fix
## Failing test (sketch)
(the test that would fail today and pass after the fix, as code in this file, naming the test file it belongs in; or "no test can express this" with the reason. Do not create the test in the repo.)
\`\`\`

A finding is something you traced in the code. A suspicion you could not trace goes in the coverage note under "Not settled", not in a finding file.
${
  KNOWN
    ? `
Earlier rounds already have findings. Read \`${OUT}/INDEX.md\` first: it lists them by id. Do not write up one of those again. When what you read changes the reach or the severity of one, say so in your coverage note under "Bears on known findings", with its id.
`
    : ""
}`;

const COVERAGE_FORMAT = `
## Coverage note

Write one at the path given below, whether or not you found anything:

\`\`\`
# Coverage: <your area>

- Commit: ${SHA}

## What was read
(files with line ranges, and for server functions the function names; "all of X" only when you read all of X, and then name what is in X)
## What was checked
(each question from your brief, and the answer with path:line. Include what turned out to be right and why.)
## Findings
(file name, severity, one line each; or "none")
## Bears on known findings
(the id from INDEX.md and what changes; or "nothing")
## Not settled
(suspicions you could not trace, and what would settle them; name the area that should pick each up)
## Not read
(anything in your brief you did not get to, by name, and why)
## Tools that would have helped
\`\`\`
`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    coverage_note_path: { type: "string" },
    coverage_summary: {
      type: "string",
      description: "Three sentences at most: what was read, what was not.",
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description: "Absolute path of the finding file you wrote.",
          },
          title: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          where: { type: "string", description: "The main path:line." },
        },
        required: ["file", "title", "severity", "where"],
      },
    },
    bears_on_known: {
      type: "array",
      items: { type: "string" },
      description: "One line each: the INDEX.md id, and what changes.",
    },
    not_settled: { type: "array", items: { type: "string" } },
    not_read: { type: "array", items: { type: "string" } },
    write_failures: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  required: [
    "coverage_note_path",
    "coverage_summary",
    "findings",
    "bears_on_known",
    "not_settled",
    "not_read",
    "write_failures",
  ],
};

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string" },
          verdict: {
            type: "string",
            enum: [
              "confirmed",
              "confirmed-narrower",
              "refuted",
              "could-not-settle",
            ],
          },
          severity: { type: "string", enum: ["high", "medium", "low", "none"] },
          reason: {
            type: "string",
            description: "Two sentences at most, with the deciding path:line.",
          },
          appended: { type: "boolean" },
          second_pass_text: {
            type: "string",
            description:
              "The full Second pass section, only when the write was refused; otherwise empty.",
          },
        },
        required: [
          "file",
          "verdict",
          "severity",
          "reason",
          "appended",
          "second_pass_text",
        ],
      },
    },
  },
  required: ["verdicts"],
};

const RECHECK_SCHEMA = {
  type: "object",
  properties: {
    rechecks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "The finding file name." },
          result: {
            type: "string",
            enum: [
              "holds",
              "holds-with-corrections",
              "no-longer-holds",
              "not-version-dependent",
              "could-not-settle",
            ],
          },
          severity_after: {
            type: "string",
            enum: ["high", "medium", "low", "none", "unchanged"],
          },
          what_changed: {
            type: "string",
            description:
              'Two sentences at most, with the library line. "Nothing" when nothing does.',
          },
          appended: { type: "boolean" },
          section_text: {
            type: "string",
            description:
              "The full Version re-check section, only when the write was refused; otherwise empty.",
          },
        },
        required: [
          "file",
          "result",
          "severity_after",
          "what_changed",
          "appended",
          "section_text",
        ],
      },
    },
    library_changes_seen: {
      type: "array",
      items: { type: "string" },
      description:
        "One line per security-relevant difference between the old and locked versions, whether or not a finding cites it.",
    },
  },
  required: ["rechecks", "library_changes_seen"],
};

const GAPS_SCHEMA = {
  type: "object",
  properties: {
    gaps_note_path: { type: "string" },
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          what: {
            type: "string",
            description:
              "The file, function, route or question nobody covered.",
          },
          area: { type: "string" },
          why_it_matters: { type: "string" },
        },
        required: ["what", "area", "why_it_matters"],
      },
    },
    independence_problems: {
      type: "array",
      items: { type: "string" },
      description:
        "Any note that says its reviewer read another reviewer's files, or anything else that weakens independence.",
    },
    write_failure_content: { type: "string" },
  },
  required: [
    "gaps_note_path",
    "gaps",
    "independence_problems",
    "write_failure_content",
  ],
};

function reviewPrompt(b) {
  return `You are a security reviewer for one part of dialed.run, a social run-wardrobe app on Cloudflare Workers (TanStack Start, D1 through Drizzle, R2, Queues, Better Auth). The repo is public, so an attacker can read all of this code first. Your job is to read the code in your brief and find how it could be misused, then write down what you found and what you read.

## Your brief: ${b.title}

${b.scope}
${
  b.start
    ? `
Where to start (a starting list, not a boundary; follow the code where it goes): ${b.start}
`
    : ""
}
Read the code, not only the docs. A doc or a comment saying a check exists is a lead; the check itself, with its path:line, is the evidence. Think as the attacker for each entry point: a stranger with no account, an ordinary signed-in runner, a runner another runner has blocked, a banned or deleted account, another website open in a signed-in runner's browser, and, where code runs for an operator, what a runner can make the operator's action do.

Cover all of your brief before going wider. Other reviewers cover the other areas: when you meet something outside yours, give it one line under "Not settled" in your coverage note and move on.
${RULES}${SEVERITY}${FINDING_FORMAT}${COVERAGE_FORMAT}
Your coverage note goes at \`${OUT}/coverage/${PREFIX}${b.key}.md\` and your finding files start with \`${PREFIX}${b.key}-\`.${
    CUT_OFF.includes(b.key)
      ? `

**An earlier attempt at this brief was cut off before it reported.** It may have left a coverage note at your path, or finding files with your prefix. If any exist, they are unfinished work nobody has checked: read them, re-check each against the code as if someone else had written it, then keep, correct or delete each one, and finish what the brief still needs. Your coverage note must describe what you read yourself. Return every finding file that stands.`
      : ""
  }

Finish by returning the structured result. Return findings exactly as written to disk; a finding without a file (or a write_failures entry) does not exist.`;
}

function verifyPrompt(files, title) {
  const list = files.map((f) => `- \`${f}\``).join("\n");
  const one = files.length === 1;
  return `You are the second, independent pass on ${one ? "a security finding" : "some security findings"} in dialed.run (area: ${title}). A first reviewer wrote ${one ? "it" : "them"} up; a finding counts only if you confirm it against the code yourself. Your job is to try to refute ${one ? "it" : "each one"}. A confirmation has to rest on lines you read yourself, not on the first reviewer's quotations.

${one ? "The finding file" : "The finding files"}:
${list}

For each finding:

1. Read the file, then put its reasoning aside and read the code it cites yourself, at the pinned commit. Check that every quoted line says what the finding says it does.
2. Trace the path from the outside in: how does a request reach this code, and what runs first? Look for the check the first reviewer may have missed: a gate in a caller, a wrapper in \`src/server.ts\` or \`src/start.ts\`, a schema that already rejects the input, a query predicate, a database constraint, a library default (read the library at the locked version), a header or cookie attribute.
3. Decide whether the attacker named can do what is claimed, step by step. A step you cannot support from the code means the finding is not confirmed.
4. Judge the severity yourself with the scale below, and judge the fix: is it the smallest change that closes it, and would the sketched test fail today and pass after?

Verdicts: **confirmed**, **confirmed-narrower** (real, but less than claimed: say exactly what holds), **refuted** (name the path:line that stops it), **could-not-settle** (say what would settle it). When you are unsure whether a step holds, the verdict is could-not-settle, not confirmed.

Then append a section to the end of each finding file (do not change what is above it):

\`\`\`
## Second pass

- Verdict: confirmed | confirmed-narrower | refuted | could-not-settle
- Severity (second pass): high | medium | low | none
- Commit: ${SHA}

### What I checked
(each step of the path, with path:line; the mitigations you looked for and whether each exists)
### What differs from the first pass
### Fix and test
(agree, or the correction)
\`\`\`
${RULES}${SEVERITY}
In \`${OUT}\` you read and append to the finding file${one ? "" : "s"} listed above and nothing else.

Return one verdict per finding file.`;
}

function recheckPrompt(g) {
  const list = g.files.map((f) => `- \`${OUT}/findings/${f}\``).join("\n");
  return `An earlier round of a security audit of dialed.run wrote the findings below. Each has a first reviewer's account and a "Second pass" from a verifier. Since then the libraries they rest on have changed, or were read at the wrong version: ${STALE.list}. Your job is to re-check each finding against the locked versions, which are what would ship.

The finding files:
${list}

Several of these files may describe the same problem from different reviewers; check each file on its own citations.

How to work:

1. First learn what changed. For each changed package a finding leans on, diff its directory in \`${STALE.path}\` (the old copy: for comparison only, never cite it as the truth) against the same package in the locked install. Read the differences that touch behaviour.
2. For each finding file, list every step that rests on library behaviour, cited or not: an endpoint being routed, a default option, a cookie attribute, an origin or rate-limit check, a token's lifetime, a parser's limits. Re-read each at the locked version.
3. Decide: **holds** (every library step is the same at the locked version), **holds-with-corrections** (the finding stands but a citation, a step or the fix needs changing: say exactly what), **no-longer-holds** (the locked version closes it: name the line), **not-version-dependent** (no step rests on a changed package), **could-not-settle**.
4. If the locked version changes how bad it is, give the severity it should now have.

Append a section to the end of each finding file (change nothing above it):

\`\`\`
## Version re-check (locked dependencies)

- Result: holds | holds-with-corrections | no-longer-holds | not-version-dependent | could-not-settle
- Severity after re-check: high | medium | low | none | unchanged
- Packages re-read: <name and locked version>

### Library steps re-read
(each step, the locked library path:line, and whether it differs from what the finding says)
### Corrections
(to a citation, a step, the fix or the test; or "none")
\`\`\`

Do not re-argue the parts of a finding that rest only on the app's own code.
${RULES}
In \`${OUT}\` you read and append to the finding files listed above and nothing else.

Return one entry per file, and separately one line for each security-relevant difference between the old and locked versions that you noticed, whether or not a finding cites it.`;
}

function gapsPrompt(missing) {
  return `You are checking the coverage of a security audit of dialed.run for holes. Reviewers each read one area and wrote a coverage note in \`${OUT}/coverage/\`. Your job is to find what nobody read.

1. Build the inventory from the pinned code: every createServerFn (git grep in src/), every route file with a server or handlers block, the queue and cron handlers reached from src/server.ts and what each dispatches to, every file in src/env/, src/lib/ and src/lib/sql/, every file in each src/modules/ directory, wrangler.jsonc, public/_headers, every workflow in .github/workflows/, and tracked code outside src/ (scripts/, eval/).
2. Read every coverage note in \`${OUT}/coverage/\` except earlier gap lists (files named \`*00-gaps.md\`), and only those: do not read \`${OUT}/findings/\`.
3. List each inventory item that no note names as read, and each question in an area's brief that its note neither answers nor lists under "Not read". A note that says "all of X" covers X only if it also names what is in X. Also list each "Not settled" line that hands a question to another area which that area's note does not pick up, and each point where two notes disagree and neither settles it.
4. Separately, list anything that weakens the reviewers' independence: a note saying its reviewer read another reviewer's files, or read a library at a version other than the locked one.

This round's briefs were: ${BRIEFS.map((b) => `${PREFIX}${b.key} (${b.title})`).join("; ")}.${missing.length ? ` No note exists for: ${missing.join(", ")}; report each as a whole-area gap.` : ""}

Write the result to \`${OUT}/coverage/${PREFIX}00-gaps.md\`, grouped by area: what was not covered, and why it matters for security (one line each). Start with what the check found fully covered. Do not look for vulnerabilities yourself; this is an inventory check, and no line should say something is vulnerable.
${RULES}
The independence rule has one exception here: you read the coverage notes. If the write is refused, return the note's content in write_failure_content.`;
}

function chunk(xs, n) {
  const out = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const recheckRun = parallel(
  RECHECKS.map(
    (g) => () =>
      agent(recheckPrompt(g), {
        label: `recheck:${g.key}`,
        phase: "Version re-check",
        schema: RECHECK_SCHEMA,
      }).then((r) => ({ group: g.key, result: r })),
  ),
);

const reviewRun = pipeline(
  BRIEFS,
  (b) =>
    agent(reviewPrompt(b), {
      label: `review:${b.key}`,
      phase: "Review",
      schema: REVIEW_SCHEMA,
    }),
  async (review, b) => {
    if (!review) return { key: b.key, review: null, verdicts: [] };
    const written = review.findings.filter((f) => f.file);
    const serious = written.filter((f) => f.severity !== "low");
    const lows = written.filter((f) => f.severity === "low");
    // High and medium get a verifier each. Lows are batched, which is a
    // lighter second pass: the log line says so, and the report must too.
    const jobs = [
      ...serious.map((f) => ({
        files: [f.file],
        label: `verify:${b.key}:${f.severity}`,
      })),
      ...chunk(lows, 4).map((c, i) => ({
        files: c.map((f) => f.file),
        label: `verify:${b.key}:lows-${i + 1}`,
      })),
    ];
    if (lows.length > 1)
      log(
        `${b.key}: ${lows.length} low findings verified in batches of up to 4; ${serious.length} high/medium verified one each`,
      );
    const vs = await parallel(
      jobs.map(
        (j) => () =>
          agent(verifyPrompt(j.files, b.title), {
            label: j.label,
            phase: "Second pass",
            schema: VERDICT_SCHEMA,
          }).then(
            (v) =>
              v || {
                verdicts: j.files.map((f) => ({
                  file: f,
                  verdict: "could-not-settle",
                  severity: "none",
                  reason: "verifier did not return",
                  appended: false,
                  second_pass_text: "",
                })),
              },
          ),
      ),
    );
    const verdicts = vs.filter(Boolean).flatMap((v) => v.verdicts);
    const unverified = written.filter(
      (f) => !verdicts.some((v) => v.file === f.file),
    );
    if (unverified.length)
      log(
        `${b.key}: ${unverified.length} finding(s) came back with no verdict: ${unverified.map((f) => f.file).join(", ")}`,
      );
    return { key: b.key, review, verdicts };
  },
);

const [rechecks, reviews] = await Promise.all([recheckRun, reviewRun]);

const missingReviews = BRIEFS.filter(
  (b, i) => !reviews[i] || !reviews[i].review,
).map((b) => b.key);
if (missingReviews.length)
  log(`No review came back for: ${missingReviews.join(", ")}`);
const missingRechecks = RECHECKS.filter(
  (g, i) => !rechecks[i] || !rechecks[i].result,
).map((g) => g.key);
if (missingRechecks.length)
  log(`No version re-check came back for: ${missingRechecks.join(", ")}`);
const rechecked = rechecks
  .filter((r) => r && r.result)
  .flatMap((r) => r.result.rechecks.map((x) => x.file.split("/").pop()));
const notRechecked = RECHECKS.flatMap((g) => g.files).filter(
  (f) => !rechecked.includes(f),
);
if (notRechecked.length)
  log(
    `${notRechecked.length} finding file(s) have no version re-check: ${notRechecked.join(", ")}`,
  );

let gaps = null;
if (A.gap_check !== false && BRIEFS.length) {
  phase("Gaps");
  gaps = await agent(gapsPrompt(missingReviews), {
    label: "coverage-gaps",
    phase: "Gaps",
    schema: GAPS_SCHEMA,
  });
}

return {
  commit: SHA,
  out: OUT,
  missing_reviews: missingReviews,
  missing_rechecks: missingRechecks,
  not_rechecked: notRechecked,
  rechecks: rechecks
    .filter((r) => r && r.result)
    .map((r) => ({
      group: r.group,
      rechecks: r.result.rechecks,
      library_changes_seen: r.result.library_changes_seen,
    })),
  areas: reviews.filter(Boolean).map((r) => ({
    area: r.key,
    coverage_note: r.review ? r.review.coverage_note_path : null,
    summary: r.review ? r.review.coverage_summary : null,
    bears_on_known: r.review ? r.review.bears_on_known : [],
    not_settled: r.review ? r.review.not_settled : [],
    not_read: r.review ? r.review.not_read : [],
    write_failures: r.review ? r.review.write_failures : [],
    findings: r.review
      ? r.review.findings.map((f) => ({
          ...f,
          second: r.verdicts.find((v) => v.file === f.file) || null,
        }))
      : [],
  })),
  gaps,
};
