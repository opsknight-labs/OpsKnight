# OpsKnight release-quality contract

This contract defines the minimum evidence required before a stable OpsKnight image is published. A release tag is not a substitute for passing evidence, and a green image build is not by itself a product release.

## Required gates

Every stable `vMAJOR.MINOR.PATCH` release must pass:

1. **Clean installation** — apply the complete Prisma history to an empty PostgreSQL database and run the database smoke check.
2. **Upgrade from the previous stable release** — deploy the previous tag's migrations to a separate database, apply the candidate migrations, and verify migration health.
3. **Migration failure behavior** — validate the fail-closed entrypoint and recovery-helper contract; unknown failures must not be silently marked applied.
4. **Backup and restore** — dump the candidate database, restore it into a new database, and run migration/database health checks against the restored copy.
5. **Event lifecycle** — prove trigger, acknowledge, and resolve against one deduplication key and verify the final incident/timeline state.
6. **Escalation and notification delivery** — execute user/team escalation flows with deterministic provider doubles and verify persisted notification records.
7. **Deployment rendering** — lint/render Helm, render Kustomize, and validate Compose plus security/startup invariants.
8. **Published architectures** — build the stable image for `linux/amd64` and `linux/arm64`; PR and main test images may remain AMD64-only for speed.
9. **Documentation coverage** — resolve v1.4 relative links and verify the capability inventory has destinations for the required product workflows.
10. **Security and general regression** — the normal test and security workflows must also pass for the release commit.

The `release-quality` job in `.github/workflows/docker-image.yml` runs before stable image publication. If any gate fails, the release image job does not start. Main and pull-request image validation still use a lightweight no-release path.

## Evidence and exceptions

- Keep GitHub Actions logs and test artifacts with the release.
- Record the previous tag selected by the upgrade test.
- When no previous stable tag exists, the workflow records that the upgrade gate is not applicable; it must not fabricate a pass.
- External providers are tested with deterministic doubles in CI. Before announcing a production release, maintainers must also run controlled provider acceptance tests in a non-production installation.
- Backup CI proves PostgreSQL dump/restore mechanics for the candidate schema. Operators remain responsible for storage, encryption, retention, scheduling, monitoring, and restore drills in their environment.
- Do not bypass a failed gate by retagging the same commit. Fix the cause, rerun the full contract, and create the release only from passing evidence.
