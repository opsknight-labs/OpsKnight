# Releasing OpsKnight

OpsKnight uses Git Flow: `develop` holds the next release, and `main` holds only released, tagged code.

```
feat/* fix/* ──PR (squash)──▶ develop ──release PR (merge commit)──▶ main ──tag vX.Y.0──▶ release
                                  ▲                                     │
                                  └──── PR main → develop ◀── hotfix/* ─┘ (tag vX.Y.Z)
```

## Branches and protection

| Branch | Takes | Merge method |
|---|---|---|
| `develop` (default) | `feat/*`, `fix/*`, `docs/*`, Dependabot | Squash |
| `main` | Release PRs from `develop`, and `hotfix/*` | Merge commit |

**Both branches require:**
- a PR, with no direct pushes, force-pushes or deletion;
- the `test` and `Security Summary` checks, with the branch up to date;
- resolved conversations;
- a code-owner approval (repository admins can bypass this for their own PRs).

**`main` also requires `Release source`,** which rejects any PR that isn't from `develop` or `hotfix/*`.

**`v*` tags** can only be created by admins, and can't be moved or deleted.

## Image channels

| Source | Image | Purpose |
|---|---|---|
| PR with the `ci:full` label (one run per label add) | `ghcr.io/opsknight-labs/opsknight-test:pr-<N>` | Testing a PR |
| Push to `develop` | `ghcr.io/opsknightlabs/opsknight-test:{develop,latest,sha-*}` (built in the backup repo) | Staging |
| Push to `main` | `ghcr.io/opsknight-labs/opsknight-test:{main,sha-*}` | Smoke check of released code |
| Tag `vX.Y.Z-rc.N` | `ghcr.io/opsknight-labs/opsknight:X.Y.Z-rc.N` (and agent), GitHub pre-release | Release candidates |
| Tag `vX.Y.Z` | `ghcr.io/opsknight-labs/opsknight:{X.Y.Z,X.Y,X,latest}`, agent, pgbouncer, SBOM, GitHub release | Users |

**Docker Hub:** when the repo variable `DOCKERHUB_NAMESPACE` and the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set, the release job also copies the published tags to `docker.io/<namespace>/{opsknight,opsknight-agent,opsknight-pgbouncer}` with identical digests (`scripts/ci/mirror-dockerhub.sh`). Release candidates copy only their own tag. A Docker Hub failure does not fail the release. To backfill existing tags by hand: `DOCKERHUB_NAMESPACE=opsknight GHCR_TOKEN=$(gh auth token) scripts/ci/mirror-dockerhub.sh all` after `docker login`.

**Release-tag approval:** builds and checks run unattended. Publishing to users waits for approval in the **`production`** environment, so open the run and click **Review deployments → Approve**.

## Release (vX.Y.0)

1. Confirm `develop` is green and staging looks right.
2. On a branch from `develop`, bump `version` in `package.json` and add the CHANGELOG entry, then merge that PR into `develop`.
3. **Optional:** tag `vX.Y.0-rc.1` on `develop` for testers:
   ```bash
   git tag vX.Y.0-rc.1 origin/develop
   git push origin vX.Y.0-rc.1
   ```
   The tag must match `package.json`'s version, so bump `package.json` to `X.Y.0-rc.1` first, or skip the rc tag.
4. Open a PR from **`develop` into `main`** and merge it with a **merge commit**.
5. Tag the merge commit:
   ```bash
   git tag vX.Y.0 origin/main
   git push origin vX.Y.0
   ```
6. Approve the `production` deployment in the tag's **Docker Image** run.

## Hotfix (vX.Y.Z)

1. Branch from main:
   ```bash
   git switch -c hotfix/<name> origin/main
   ```
2. Fix the bug, bump `package.json` to `X.Y.Z`, and add the CHANGELOG entry.
3. Open a PR into **`main`** and merge it with a merge commit.
4. Tag it and approve it as in a release (`vX.Y.Z`).
5. **Back-merge:** open a PR from **`main` into `develop`** so the fix reaches the next release. Resolve any conflicts on a branch from `develop` if needed. This step is manual on purpose: PRs opened by `GITHUB_TOKEN` don't run CI.

## Heavy suites and Actions budget

Heavy suites run in a nightly batch on `develop` (`main-heavy.yml`), and on a PR once each time `ci:full` is added. Before a release, run **Main heavy batch** with `force`. See [`CI_TEST_INVENTORY.md`](CI_TEST_INVENTORY.md) and AGENTS.md section 8. The org was flagged once for Actions volume, so `actions-budget.yml` alerts above 1,200 minutes in 24 hours.
