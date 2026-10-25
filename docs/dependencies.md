# Dependencies

How dialed.run's dependencies stay current, what merges itself, and why
that is safe enough (design 156). The configuration is
`.github/dependabot.yml` and `.github/workflows/dependabot-pr.yml`; this
file explains them and does not restate them.

## What happens to an update

1. **Dependabot opens a PR**, weekly and seven days behind each release.
   Security updates skip the wait.
2. **If it moves a package the bundles ship**, CI's build fails on the
   stale open-source list. `oss-list.yml` rebuilds the list, read-only, and
   `oss-list-commit.yml` commits it to the PR as the automation App. CI
   then runs again on that commit by itself.
3. **`dependabot-pr.yml` classifies it.** If every package in it is an npm
   update that semver calls compatible (a minor at 1.0 or above, or a patch
   anywhere but 0.0.x) and was published by the same maintainers, auto-merge
   is armed. GitHub merges it once every required check passes on the head
   commit, with a merge commit, as the App, so main's deploy and its cold
   mutation run start as they would after any merge.
4. **Anything else waits for you**: majors, 0.x minors, 0.0.x updates, new
   maintainers, and every GitHub Actions bump (Actions run with this repo's
   secrets). Claude posts an impact review on the PR: a verdict, the
   breaking changes, whether each touches this repo (with file and line),
   and its sources. It is advisory. Read the sources before trusting it.

The checks that carry an unattended merge are the required set:
`Lint, typecheck, test, build`, `e2e`, `e2e (build)`, `guardrails` and
`Mutation`. `e2e (build)` exists because the dev server never runs the
production bundle, and the updates most likely to break the app
(Vite, the Cloudflare plugin, TanStack Start, React) can break the build's
server rendering while dev stays green.

**When a self-merging PR fails**, nothing merges and the PR stays open. Fix
it on Dependabot's branch, or close it and let next week's run try again.
**When a family can't move yet** (TypeScript 7 before a tool supports it),
close its PR with a comment, or add an `ignore` for that major in
`dependabot.yml` saying why and until when.

## Setup (owner, once)

GitHub settings, invisible in the diff. Do them in this order, after the
PR that adds the workflows has merged:

1. **Create the automation App** (Settings → Developer settings → GitHub
   Apps): no webhook; repository permissions **Contents: read and write**
   and **Pull requests: read and write**, nothing else. Not `Workflows`,
   not `Administration`. Install it on this repository only. Generate a
   private key.
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
     `dependabot/fetch-metadata@*`.
   - Require actions to be pinned to a full-length commit SHA.
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
  structured output that a separate job, with no model, posts.
- **No outbound network but a short list**: `harden-runner` blocks
  everything except the hosts the action installs from and Claude reads
  from (GitHub and the npm registry), none of which shows a stranger what
  was requested.
- **Narrow tools**: Read, Grep and Glob over the repo; web reads from
  GitHub and the npm registry only; `gh` only to read releases. No shell
  beyond that, no edits, no web search. Reads of process state and the
  runner's files are denied.
- **A capped key**: the Anthropic key is a workspace key with a spend
  limit, not an account login.
- **A screened comment**: the post job checks the review's shape and size,
  refuses anything shaped like a credential, defuses every `@`-mention (one
  could summon `@dependabot` or page a person), renders the table itself,
  and labels the comment advisory.
- **Main only**: the job checks out main, so no file a PR controls
  (`.claude/`, `CLAUDE.md`, hooks) is in its workspace.
- `show_full_output` stays off, since these logs are public. No workflow
  in this repo triggers on comments, so nobody can summon Claude.

What an injection can still do is write a misleading verdict on a PR that
you merge yourself. No automation reads the verdict.

**What auto-merge does and doesn't change.** The real risk is a
compromised release that survives the cooldown: it would merge, deploy,
and run its install scripts in the deploy job. Honestly, merging by hand
would not catch it either; nobody reads a lockfile diff. What does:

- the 7-day cooldown, and holding back versions with new maintainers;
- `npm audit signatures`: registry signatures, and provenance where it
  was published;
- `lockfile-lint` in `npm run lint`: every entry from `registry.npmjs.org`
  (or the guardrails-core release, by exact URL), over https, with an
  integrity hash, its tarball named for its package. This guards every PR,
  agents' included, not only Dependabot's;
- the Cloudflare secrets in a `production` environment and a token scoped
  to what deploy needs (`docs/deployment.md` §7).

**Not done yet** (R-166): an install-script allowlist. npm 11.19 warns about
packages whose install scripts aren't covered by `allowScripts`
(workerd, esbuild, canvas, fsevents today). An allowlist would stop a new
dependency's install script from running at all. It needs the npm that CI
installs to enforce it, which has not been checked.
