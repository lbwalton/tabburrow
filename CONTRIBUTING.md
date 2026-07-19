# Contributing to TabBurrow

Thanks for wanting to work on TabBurrow. This is a small, actively-building
open-source project; expect fast iteration and a build tracker
(`stories/stories.json`) that's more honest than polished. Here's how to
get productive quickly.

## Dev setup

Requires **Node 20+** and **pnpm 9+**.

```sh
git clone https://github.com/lbwalton/tabburrow.git
cd tabburrow
pnpm install
```

That's it for the local extension: no environment variables, no backend,
no account. If you're working on cloud sync, AI organize, sharing, or
billing, see [SELF_HOSTING.md](SELF_HOSTING.md) for your own Supabase
project.

### Dev commands per app

```sh
# Extension (WXT)
pnpm --filter extension dev       # dev build, auto-reload
pnpm --filter extension build     # production build → apps/extension/.output/chrome-mv3
pnpm --filter extension test      # vitest
pnpm --filter extension typecheck # wxt prepare + tsc --noEmit
pnpm --filter extension e2e       # Playwright extension QA suite — build first (see apps/extension/e2e/README.md); one-time setup: npx playwright install chromium

# Web (Next.js)
pnpm --filter web dev             # localhost:3000
pnpm --filter web build
pnpm --filter web typecheck

# core / ui packages
pnpm --filter core test
pnpm --filter core typecheck
pnpm --filter ui typecheck
pnpm --filter ui preview          # component preview, localhost:5175
```

Or, across the whole monorepo:

```sh
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

To load the extension in Chrome after building: `chrome://extensions` →
enable Developer mode → **Load unpacked** → select
`apps/extension/.output/chrome-mv3`.

## Test commands

- `pnpm --filter core test`: Vitest, pure logic (fractional indexing,
  repositories, sync/merge engine).
- `pnpm --filter extension test`: Vitest, extension `lib/` logic
  (popup state, search, drag-reorder, importers, sessions, etc.).
- `apps/web` and `packages/ui` don't have a test suite yet; `pnpm -r test`
  runs whichever packages have a `test` script and skips the rest.

## How this codebase is built

TDD-first for anything that isn't a thin UI wrapper: pure logic lives in
a `lib/` (extension) or `src/` (core) module with its own test file, and
the tests are written to describe behavior, not implementation. React
components stay thin; they call into tested `lib/` functions rather than
holding business logic themselves. If you're adding a feature with real
logic (parsing, merging, ordering, metering, anything with edge cases),
add a test file alongside it.

Every story lands as its own commit (see the commit conventions below),
and every non-trivial change gets a self-review pass before it's
considered done; read your own diff like a reviewer would before opening
a PR.

## Commit conventions

This repo follows Conventional-Commits-style subjects, observed
throughout the git history:

```
<type>(<scope>): <short summary>
```

- **Types:** `feat`, `fix`, `chore`, `docs`.
- **Scopes:** `ext` (apps/extension), `core` (packages/core), `ui`
  (packages/ui), `web` (apps/web), or omitted for repo-wide changes.
  Multiple scopes are fine when a fix spans packages: `fix(core,ext): ...`.
- Keep the summary short and in the imperative mood: `feat(ext): fuzzy
  search everywhere`, not `Added fuzzy search`.

Examples from this repo's history:

```
feat(core): LWW+tombstone sync engine
fix(ext): pending-command rollback, pre-paint theme init
chore: mark T17 done in story tracker
docs: TabBurrow implementation plan (26 tasks, 4 phases)
```

## Pull requests

- One logical change per PR: a story, a bug fix, a doc update. Avoid
  bundling unrelated changes.
- Fill out the PR template: what changed, why, and how you tested it.
- Make sure `pnpm -r typecheck` and `pnpm -r test` pass locally before
  opening the PR; CI runs the same checks plus both app builds and will
  block merge on failure.
- If you're changing behavior a user would notice, say so in plain
  language in the PR description, not just in code comments.
- Small, focused PRs get reviewed faster than large ones.

## Reporting bugs / requesting features

Use the issue templates; they ask for exactly what's needed to
reproduce a bug or evaluate a feature request without back-and-forth.

## Code of conduct

Be kind, be direct, assume good faith. Disagree about code, not about
people. Harassment, discrimination, or personal attacks aren't tolerated
and will get you removed from the project. If something's off, open an
issue or contact the maintainer directly; see the contact info in the
repo's GitHub profile.

## License note

TabBurrow is licensed under [AGPL-3.0](LICENSE). By contributing, you
agree that your contributions are licensed under the same terms; this
keeps the whole project, including everyone's contributions, genuinely
open source.
