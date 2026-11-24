# CI strategy: catch bugs early, stay under GitHub's abuse limits

GitHub flagged this organization for a surge in Actions compute. Two things cause a flag: **total minutes** and
**bursts** (many parallel jobs in a short time). The rule is to **spend heavy minutes once per change, at the point
it is about to merge, and spread everything else out**, with cheap checks first so nothing heavy runs on code that
already fails one.

`AGENTS.md` (section on CI) is the operating summary; `docs/CI_TEST_INVENTORY.md` lists every workflow.
This page explains the design and what is still open.

## The layers as they are today

| Layer | Where | What runs | Cost |
|---|---|---|---|
| 1. Commit | your machine (`pre-commit`, `commit-msg`) | lint-staged on staged files, commit-message format | seconds |
| 2. Push | your machine (`pre-push`) | typecheck, unit tests related to the changed files, database checks when backend files changed | minutes, free |
| 3. Pull request | GitHub, on ready PRs (drafts skip) | change detection, static validation, unit tests, the build when UI or backend files changed, security scans | about 30 min when the build runs |
| 4. Opt-in, before merge | GitHub, label `ci:full` (one-shot) | heavy suites whose paths changed: browser E2E, runbook, MCP, SSO, SCIM, Teams, automation, certification | per suite |
| 5. Nightly | GitHub, `develop` | the whole `Tests` run (including the database jobs) and `Security`, and `main-heavy.yml` runs each heavy suite whose paths changed | once a day |
| 6. Release | GitHub, tags and `main` | the PR gate and database jobs on the release merge, then runbook and SBOM on the tag, the image build, signing and approval | per release |

Database integration, ingestion durability and the database secret scripts **do not run on pull requests**. They run
locally in `pre-push`, on `main`, nightly and on manual runs. Release tags run only runbook and SBOM directly, so
before tagging run **Main heavy batch** with `force`; the tag does not supply the other heavy suites.

## Rules that keep us under the limits

1. **No work on drafts.** Open a draft while the change is in progress.
2. **Path-aware.** Docs-only and UI-only changes skip the jobs they cannot affect (`changes` job).
3. **Cancel superseded runs.** Every workflow has a concurrency group.
4. **Nothing re-runs on merge.** The nightly run covers `develop`.
5. **Every job has a timeout.** A hung job otherwise runs for up to six hours, which is exactly the kind of
   compute surge that triggers a flag. A new job without `timeout-minutes` should not merge.
6. **Stagger schedules.** No two scheduled workflows start in the same minute.
7. **Keep the parallel width small.** Do not add database shards or matrix legs without removing minutes elsewhere.
8. **A budget alarm.** `actions-budget.yml` fails above `ACTIONS_DAILY_MINUTES_BUDGET`; set it to about 60% of the
   measured daily average once two weeks of data exist.
9. **The backup repo runs nothing.** `backup-mirror.yml` keeps every workflow there disabled and refuses manual
   runs from any branch except `develop`.

## Hooks

- `pre-commit` stays fast.
- `pre-push` runs only the unit tests that import a changed file and skips the production build, because the PR gate
  runs the whole unit suite and the build. Set `FULL_PUSH=1` to run the full suite and a build before pushing.
  A hook that takes too long gets skipped with `--no-verify`, which catches nothing.
- The database checks stay in `pre-push` and run when backend files changed (`SKIP_DB_TESTS=1` skips once).
- Hooks are installed by `npm install` (`prepare`); forks and fresh clones without it have none, so CI never
  assumes a developer ran them.

## What is still open

1. **Database regressions are only caught locally or the next night.** A bypassed hook or a fork ships them to
   `develop`. Option: let the `ci:full` label also run the database jobs for backend PRs, so a risky PR can opt in.
2. **Rebalance database shard 2** (16 minutes against a 20-minute limit).
3. **Set the budget alarm from measured minutes** rather than the placeholder.
4. **Lint the workflows** (`actionlint`) on PRs that touch `.github/`, pinned by checksum.
