# CI strategy: catch bugs early, stay under GitHub's abuse limits

GitHub flagged this organization for a surge in Actions compute. Two things cause a flag: **total minutes** and
**bursts** (many parallel jobs in a short time). Every PR push currently starts about nine parallel jobs
(build, unit tests, six database shards), roughly 90 machine-minutes, so a few PRs pushed together look like a surge.

The rule: **spend the heavy minutes once per change, at the point it is about to merge, and spread everything
else out.** Bugs are caught by cheap checks first, so nothing heavy runs on code that fails a cheap check.

## The layers

| Layer | Where | What runs | Cost |
|---|---|---|---|
| 1. Commit | your machine (`pre-commit`, `commit-msg`) | lint-staged (ESLint and formatting on staged files), commit-message format | seconds |
| 2. Push | your machine (`pre-push`) | full typecheck, unit tests, build, database checks | minutes, free |
| 3. Pull request | GitHub, every push | change detection, static validation (lint, typecheck, docs, API clients), unit tests, security scans | about 25 min |
| 4. Ready to merge | GitHub, once per PR | application build, database shards, ingestion durability, migration checks | about 70 min |
| 5. Nightly | GitHub, `develop` | the whole `Tests` and `Security` run, plus the heavy suites that changed (`main-heavy.yml`) | once a day |
| 6. Release | GitHub, tags | every heavy suite, SBOM, image build, signing, approval | per release |

A change reaches `develop` only after layers 1 to 4. Layers 5 and 6 catch what interacts across merges.

## Rules that keep us under the limits

1. **No work on drafts.** Open a draft while the change is in progress.
2. **One heavy run per PR.** Layer 4 runs when the PR is marked ready, not on every push. New commits after that
   re-run only the cheap layer 3 until the PR is marked ready again.
3. **Path-aware.** Docs-only and UI-only changes skip the database jobs (`changes` job).
4. **Cancel superseded runs.** Concurrency groups per ref (already in place).
5. **Nothing re-runs on merge.** The nightly run covers `develop`.
6. **Stagger schedules.** Nightly, the batch dispatcher and the budget alarm must not start in the same minute.
7. **Cap parallel jobs.** Keep matrix widths small; do not add shards without removing minutes elsewhere.
8. **A budget alarm.** `actions-budget.yml` fails above `ACTIONS_DAILY_MINUTES_BUDGET`. Set it to about 60% of the
   measured daily average once two weeks of data exist.
9. **No image build on PRs without the `ci:full` label.**
10. **The backup repo runs nothing.** `backup-mirror.yml` keeps every workflow there disabled.

## Local hooks: what to keep, what to change

The pre-push hook currently runs the full typecheck, the full unit suite, a production build and the database
checks on every push. That is thorough, and it is slow and heavy enough that people skip it with `--no-verify`
(and it competes with a dev server for memory). A hook that is skipped catches nothing.

- Keep `pre-commit` (fast) as is.
- Make `pre-push` scoped: typecheck, unit tests related to the changed files, and the database checks only when
  backend files changed. Leave the production build and the full unit suite to layer 3 and layer 4.
- The hook text says "CI does not run database checks on pull requests". That is not true today (the database jobs
  still run on PRs when backend files change). Either keep both or move them behind layer 4, but fix the message.
- `npm run prepare` installs the hooks; forks and fresh clones that skip `npm install` have none, so CI must never
  depend on a developer having run them.

## Rollout order (each step is its own PR)

1. This document and the restored backup sync.
2. Layer 4 gate: heavy jobs on non-draft PRs run on `ready_for_review` and on a `ready-to-merge` label, and the
   required `test` check stays red until they have run for the PR's latest commit.
3. Scope `pre-push` and correct its message.
4. Stagger the schedules; rebalance database shard 2 (16 min against a 20-minute limit).
5. Set the budget alarm from two weeks of measured minutes.
