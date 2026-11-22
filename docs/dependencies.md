# Dependencies

How dialed.run's dependencies stay current, what merges itself, and why
that is safe enough (design 156). The configuration is
`.github/dependabot.yml` and `.github/workflows/dependabot-pr.yml`; this
file explains them and does not restate them.

## What happens to an update

1. **Dependabot opens a PR**, weekly and seven days behind each release.
   Security updates skip the wait, and their minor and patch fixes share
   one PR. Every PR costs a full CI and mutation run, which is why
   `dependabot.yml` keeps the groups few.
2. **If it moves a package the bundles ship**, CI's build fails on the
   stale open-source list. `oss-list.yml` rebuilds the list, read-only, and
   `oss-list-commit.yml` commits it to the PR as the automation App. CI
   then runs again on that commit by itself.
3. **`dependabot-pr.yml` classifies it**, with `scripts/dependabot-classify.ts`
   run from main (SA-M38, SA-L10). If every package it names is an npm
   update that semver calls compatible (a minor at 1.0 or above, or a patch
   anywhere but 0.0.x), and every version it adds or moves in the lockfile,
   named or not, is at least seven days old on the registry and was
   published by an account that published that package before, auto-merge
   is armed. A registry or lockfile it cannot read holds the PR. GitHub merges it once every required check passes on the head
   commit, with a merge commit, as the App, so main's deploy and its cold
   mutation run start as they would after any merge. If the checks have
   already passed (GitHub only arms auto-merge while one is pending), the
   job merges it at once, still only at the commit it classified, or at
   that commit with the App's open-source list on top. The list can land
   while the job waits for a runner, and the run it starts doesn't
   classify again, so the job follows the head, but only past commits
   that are all the App's and change the list alone. Every later push by
   Dependabot is classified again; when the answer is not a yes (a hold,
   or a classify that failed), the `disarm` job turns auto-merge off and
   comments on the PR why it no longer merges itself.
4. **Anything else waits for you**: majors, 0.x minors, 0.0.x updates, a
   version under seven days old (a security update skips Dependabot's
   cooldown, not this one), a new publisher, and every GitHub Actions bump (Actions run with this repo's
   secrets). Claude posts an impact review on the PR: a verdict, the
   breaking changes, whether each touches this repo (with file and line),
   and its sources. It is advisory. Read the sources before trusting it.
   It runs Claude Code's `opus` alias on the Claude Code version the
   workflow pins, so a new Opus model arrives with a reviewed bump of that
   pin. A claude-code-action bump moves the Bun and Claude Code versions
   and their SHA-256 sums in `dependabot-pr.yml` and `a11y-review.yml` by
   hand, as their comments say. The review
   runs once, when the PR opens; a push to the branch does not rerun it.
   A review that failed (before the key existed, say) needs its failed
   job re-run.

The checks that carry an unattended merge are the required set:
`Lint, typecheck, test, build`, `e2e`, `e2e (build)`, `guardrails`,
`Mutation` and `Protected paths`. `Protected paths` runs from main and
passes a PR that changes the checks' own inputs (the gate, Stryker,
lint, build, test and TypeScript configs under every name their tools
look for, workflows, hooks, `scripts/`, `test/architecture/`, `.npmrc`,
the Claude settings, package.json outside its dependency lists, the
guardrails-core pin) only with the `owner-approved` label, which the
owner sets; `protected-paths.yml` lists the files. `e2e (build)` exists because the dev server never runs the
production bundle, and the updates most likely to break the app
(Vite, the Cloudflare plugin, TanStack Start, React) can break the build's
server rendering while dev stays green.

**When a self-merging PR fails**, nothing merges and the PR stays open. Fix
it on Dependabot's branch, or close it and let next week's run try again.
**When a PR falls behind main**, comment `@dependabot rebase`, except on
a grouped security PR: Dependabot rebuilds the whole group and fails on
its transitive conflicts. Merge main into that one's branch by hand.
**When a family can't move yet** (TypeScript 7 before a tool supports it),
close its PR with a comment, or add an `ignore` for that major in
`dependabot.yml` saying why and until when.

## Setup (owner, once)

GitHub settings, invisible in the diff. Do them in this order, after the
PR that adds the workflows has merged:

1. **Create the automation App** (Settings → Developer settings → GitHub
   Apps): no webhook; repository permissions **Contents: read and write**
   and **Pull requests: read and write**, nothing else. Not `Workflows`,
   not `Administration`. Install it on this repository only; another repo
   gets its own App, so a leaked key reaches one repo. Generate a private
   key: the secret is the downloaded `.pem`, whose first line is
   `-----BEGIN RSA PRIVATE KEY-----`. An SSH key there fails the token step
   with "only PKCS#8 is supported", and a mismatched App ID with "401 A JSON
   web token could not be decoded".
2. **Environment `dependabot-merge`**: deployment branches `main` only.
   Variable `AUTOMATION_APP_ID`, secret `AUTOMATION_APP_PRIVATE_KEY`.
3. **Environment `dependabot-review`**: deployment branches `main` only.
   Secret `ANTHROPIC_API_KEY`: a key from its own Anthropic Console
   workspace, with a monthly spend limit (one major's review is about
   $1–3).
4. **Settings → General**: Allow auto-merge on.
5. **Settings → Code security**: Dependabot alerts and security updates on.
6. **Settings → Actions → General**:
   - Require approval for all external contributors' fork PRs.
   - Allow GitHub's actions, verified creators' actions, and these:
     `anthropics/claude-code-action@*`, `step-security/harden-runner@*`,
     `dependabot/fetch-metadata@*`, and `oven-sh/setup-bun@*`, which
     claude-code-action runs inside itself. An action an allowed action
     calls must be allowed too; when bumping it, read the `uses:` list
     `actions.lock` records under its entry.
   - Require actions to be pinned to a full-length commit SHA. It stays on:
     GitHub counts a workflow listed in `.github/workflows/actions.lock` as
     pinned, so tag `uses:` lines pass it (D-182).
7. **Branch protection on `main`**: add `e2e (build)` to the required
   checks.

Rotate the App's private key yearly (generate a new one, replace the
secret, delete the old key). The Anthropic key rotates the same way.

## Security review

This is a public repository: anyone can fork it, open a PR, and write the
release notes Claude reads. Each part below says what it trusts.

**Gates are on the PR's author, never on `github.actor`.** Under
`pull_request_target` the actor is whoever caused the latest event, and
there is a public technique for making Dependabot the actor of a
`synchronize` on someone else's fork PR (BoostSecurity, "Weaponizing
Dependabot"). Every job checks `pull_request.user.login` and the head
repository. fetch-metadata checks the author, the head commit's author and
its signature again, and fails otherwise. Its `skip-*-verification` inputs
are never set.

**No PR code runs where a secret is.** `pull_request_target` and
`workflow_run` run main's copy of the workflow with this repo's secrets, so
those jobs check out nothing but main, run no npm, and treat what they are
handed as data. The PR's code runs only in CI's `pull_request` jobs, which
Dependabot runs with a read-only token and no secrets.

**The App is a credential.** Its key in the wrong hands can merge
arbitrary code to main, and so to production, so it is kept small: two
permissions, no `workflows`, one repository, not a bypass actor (its
merges wait on every required check), in an environment only main can
use, minted only in the two jobs that need it. Without `workflows` it most
likely cannot merge a PR that edits `.github/workflows/`, so Actions bumps
stay manual on both counts.

**The open-source list commit** follows dialed.run-site's checklist:
`workflow_run` from main; the triggering run, repository, branch, author
and head SHA all checked; the artifact one regular file under 1 MB, of the
list's exact shape, every link `https://`; no repo or package code run;
pushed without force onto the SHA that was built.

**The Claude review reads text an attacker may have written.** Release
notes, changelogs and package metadata are written by whoever publishes
the package, including someone who has taken over a maintainer's account.
So the review job is built on the assumption that a prompt injection
succeeds, and limits what one can do:

- **No write access**: its token is read-only, and the answer leaves as
  structured output, handed as a job output to a separate job, with no
  model, that posts it.
- **No outbound network but a short list**: `harden-runner` blocks
  everything except the hosts the action installs from and Claude reads
  from (GitHub and the npm registry), none of which shows a stranger what
  was requested. `harden-runner` itself fails open, so the job proves the
  fence before the key reaches any step, and again just before Claude
  runs: two hosts off the list must be unreachable and `sudo` gone, or the
  job stops (SA-L20).
- **Checked programs, the workflow's settings only**: the job fetches the
  Bun and Claude Code the action runs, checks each against a SHA-256 in
  the workflow, and hands them to the action. Claude starts with
  `--setting-sources user`, so only the settings the workflow writes are
  loaded.
- **Narrow tools**: Read, Grep and Glob over the repo; web reads from
  GitHub and the npm registry only, releases included. No shell at all:
  a command runs with the process's environment, where the key is
  (SA-M19). No edits, no web search. The Read tool is denied process state
  and the runner's files; that rule covers the Read tool only.
- **A capped key**: the Anthropic key is a workspace key with a spend
  limit, not an account login.
- **A screened comment**: the post job checks the review's shape and size,
  refuses anything shaped like a credential, defuses every `@`-mention (one
  could summon `@dependabot` or page a person), renders the table and the
  summary itself, escaped, and labels the comment advisory.
- **Main only**: the job checks out main, so no file a PR controls
  (`.claude/`, `CLAUDE.md`, hooks) is in its workspace.
- `show_full_output` stays off, since these logs are public. No workflow
  in this repo triggers on comments, so nobody can summon Claude.

What an injection can still do is write a misleading verdict on a PR that
you merge yourself. No automation reads the verdict.

**What auto-merge does and doesn't change.** The real risk is a
compromised release that survives the cooldown: it would merge, deploy,
and run in the build (`ci.yml`'s `bundle` job, which holds no secret;
the deploy job runs only Wrangler, SA-L10). Honestly, merging by hand
would not catch it either; nobody reads a lockfile diff. What does:

- the 7-day cooldown, which the classifier also applies to security
  updates and to every version the lockfile moves, and holding back
  versions from a publisher new to the package (both read from the
  registry);
- `npm audit signatures`: the registry's signature on each installed
  name and version's manifest, and provenance where it was published. It
  does not compare that manifest with the tarball installed;
- `lockfile-lint` in `npm run lint`: every entry from `registry.npmjs.org`
  (or the guardrails-core release, by exact URL), over https, with a full
  sha512 integrity hash;
- `test/architecture/lockfile-shape.test.ts` in `npm test` (SA-M18): every
  entry resolves to exactly the tarball its install path and version
  name, an alias's real name pinned in the test. These two guard every
  PR, agents' included, not only Dependabot's;
- the Cloudflare secrets in a `production` environment and a token scoped
  to what deploy needs (`docs/deployment.md` §7).

**Install scripts** (R-166, SA-L10): `.npmrc` sets
`strict-allow-scripts=true`, so an install runs a dependency's install
script only when `allowScripts` in `package.json` names the package
(workerd, esbuild, canvas, fsevents today), and any other script fails the
install with `ESTRICTALLOWSCRIPTS`. Approve a new one with
`npm approve-scripts <pkg> --no-allow-scripts-pin`. The entries are bare
names, so any later version of a named package runs its script: a pinned
entry would fail every esbuild or workerd bump until re-approved. Both
settings are npm 11.19's; `engine-strict=true` and the `engines` floor
(npm 11.19, Node 24.20) stop an older npm, which would ignore them, and
every `setup-node` sets `check-latest` so CI's Node meets the floor.
`test/architecture/install-scripts.test.ts` pins all of it. The allowlist
does nothing about code the build loads.

## The CI floor

Design 196 (#546). Three checks on the workflows themselves, on top of the
lockfile and `actionlint`:

- **`harden-runner` is the first step of every job**, and
  `test/architecture/workflow-floor.test.ts` fails a job without it. A new
  job starts at `egress-policy: audit`, which reports the hosts it reaches
  and blocks none; its run's summary links the report. A job moves to
  `block`, with that list as `allowed-endpoints`, when the list is short
  enough to keep. The two Claude review jobs are on `block` already.
- **`zizmor`** (`supply-chain.yml`) reads `.github/` on every PR for
  template injection, permissions wider than a job uses, credentials left
  in a checkout and unpinned actions. Fix a finding. An ignore is for a
  line the owner has reviewed, with its reason beside it; the same test
  pins the list.
- **Dependency review** (`supply-chain.yml`) fails a PR that adds a
  dependency with a known vulnerability, or with a licence that is not on
  the workflow's list of licences an AGPL-3.0 work can combine with. A new
  licence is the owner's call; `@garmin/fitsdk` is exempted by name.

**The workflow lockfile** (D-182, #601). Every `uses:` names a full version
tag (`actions/checkout@v7.0.1`, never `@v7` or a commit), and
`.github/workflows/actions.lock` records the commit each tag resolved to,
transitive actions included (claude-code-action's `oven-sh/setup-bun`).
The lock is generated: run `gh actions-lock` (the `github/gh-actions-lock`
extension) and commit what it writes; never edit it by hand, and
`gh actions-lock --no-fix` checks it without writing. Dependabot
regenerates a workflow's entry in its own action-bump PR, but only for a
workflow already in the lock: **a new workflow is onboarded by hand**, by
running `gh actions-lock` in the PR that adds it.
`test/architecture/workflow-floor.test.ts` fails a `uses:` that is not a
full tag, and a workflow whose actions differ from the lock's list for it.
An earlier attempt (before D-182) kept the SHA pins beside a tag-keyed
lock, and every workflow failed at startup with "The lockfile is missing";
the two do not mix.

`zizmor` and `actionlint` are release binaries at a pinned checksum, not
actions, so Dependabot does not see them. Bump the version and the
checksum together, by hand, from the release's published digest.
