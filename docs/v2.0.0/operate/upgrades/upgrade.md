---
title: Upgrade OpsKnight
description: Plan, migrate, roll out, verify, and accept an OpsKnight upgrade across supported topologies.
type: deployment
product_area: upgrades
audience: [operator, administrator]
keywords: [upgrade OpsKnight, migration upgrade, release upgrade, rolling upgrade]
reader:
  status: READER_COMPLETE
  task: Rehearse, migrate, roll out, verify, and accept an OpsKnight upgrade.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - scripts/validate-migrations.cjs
    - scripts/check-migration-health.cjs
    - docker-entrypoint.sh
    - deploy/swarm/scripts/deploy.sh
    - deploy/kubernetes/helm/opsknight/templates/migration-job.yaml
---

# Upgrade OpsKnight

An upgrade changes an immutable application image and may change the PostgreSQL schema. Treat those as separate operations with one migration owner, an explicit compatibility decision, a verified backup, and rollback criteria agreed before the window.

## Prerequisites

Prepare:

- Release notes and supported source-to-target upgrade path.
- The target image pinned by digest, with provenance verified.
- Current image digest, configuration revision, topology, runtime roles, and schema/migration state.
- A recent backup restored successfully in an isolated environment using the matching encryption keys and secrets.
- Direct PostgreSQL connectivity for the migration owner; do not migrate through transaction-mode PgBouncer.
- A maintenance/communication plan, named decision owner, and monitored soak period.
- Baseline readiness, deep health, queue ages, notification failures, scheduler state, database connections, and key journey results.

Do not start if the backup is untested, the target image is mutable, migration ownership is ambiguous, database headroom is insufficient for rollout overlap, or the old version's compatibility with the post-migration schema is unknown.

## Configure compatibility and rollback before deployment

Classify the release:

1. **Application-only or backward-compatible schema change:** the previous runtime can operate safely on the migrated schema for the rollback window.
2. **Expand/contract transition:** old and new runtimes can overlap only during a documented phase; destructive contract work happens later.
3. **Schema-breaking change:** the previous runtime cannot operate on the new schema. Rollback requires stopping writes and restoring the pre-upgrade backup, with data loss bounded by the approved RPO.

Write down which class applies and the evidence supporting it. Prisma migration success alone does not prove backward compatibility.

Define rollback triggers such as migration failure, sustained readiness failure, critical queue-age regression, notification failure, login failure, data-integrity error, or unacceptable latency. Define who can call rollback and the last point where image-only rollback remains safe.

## Rehearse

Restore a recent backup to an isolated database, deploy the target digest with production-equivalent configuration, and run:

```bash
npm run prisma:validate
npm run prisma:health
```

Apply migrations using the same mechanism planned for production. Verify sign-in, services, schedules, incident create/acknowledge/resolve, notification delivery, integrations, status publication, mobile routes, scheduler/worker progress, reports, and encrypted provider configuration. Measure migration and rollout time against the maintenance window.

## Pre-upgrade checks

1. Announce the change window and freeze unrelated configuration/schema work.
2. Confirm current alerts are understood and active incidents have an owner.
3. Record all running image digests and replica counts.
4. Capture and verify the final pre-upgrade backup.
5. Run migration validation and health against the production database without applying changes.
6. Confirm no unfinished migration exists in `_prisma_migrations`.
7. Validate runtime/database connection capacity for rollout overlap.
8. Confirm old images, old configuration, backup, keys, and restore commands are immediately available.

## Apply schema changes once

Use exactly one supported migration owner. Long-running split roles should set `OPSKNIGHT_SKIP_MIGRATIONS=true`; they must not race the migration Job/service.

Follow [Operate database migrations](database-migrations.md) for the exact Compose, Helm, and Swarm commands, safe recovery behavior, and optional SLA scheduler index boundary. Require migration exit code zero and a clean `npm run prisma:health` result before replacing application roles.

Do not edit applied migration SQL, delete migration records, use `prisma db push` in production, or mark a failure resolved merely to continue rollout.

## Roll out by topology

### Docker Compose

Render the exact file set and record its images:

```bash
docker compose <files> config --quiet
docker compose <files> config --images
docker compose <files> pull
```

For split mode, run the one-shot migration service and confirm successful exit before updating Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector. Then:

```bash
docker compose <files> up -d --wait
docker compose <files> ps -a
```

For integrated mode, only one integrated application process should own background responsibilities. Complete the backup, allow the controlled startup migration owner, and replace the application. Compose is single-host; keep host-level recovery available.

### Helm

Render and review the candidate first:

```bash
helm lint deploy/kubernetes/helm/opsknight --values values.production.yaml
helm template opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight --values values.production.yaml > rendered.yaml
```

Pin `image.digest`, keep `migrations.job.enabled=true`, and run the upgrade with the approved values:

```bash
helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight --values values.production.yaml --wait
```

The pre-upgrade migration hook must complete before workloads roll. Inspect the migration Job and rollout status; do not bypass a failed hook. Confirm PodDisruptionBudget, topology spread, NetworkPolicy, Secret references, direct migration URL, and readiness probes in the rendered manifests.

### Kustomize or raw Kubernetes

Render the selected overlay, review immutable image and Secret references, and apply the migration Job as the single schema owner before rolling Deployments. Wait for each role to become available and retain enough old capacity only when schema compatibility explicitly permits overlap.

### Docker Swarm

Set the target digest and use the repository orchestrator:

```bash
OPSKNIGHT_IMAGE='ghcr.io/opsknight-labs/opsknight@sha256:<digest>' \
  ./deploy/swarm/scripts/deploy.sh
```

It validates capacity, manages versioned secrets, runs the one-shot migration service, deploys with `--prune`, waits for convergence, and runs readiness. Do not replace this routine with an ad hoc `docker stack deploy`.

## Verify the upgrade

Complete every check before accepting the release:

1. All expected replicas run the target `deploymentId`/image digest; no unintended mixed version remains.
2. Liveness and readiness are healthy per role; authenticated deep health shows current scheduler, worker, realtime, queue, notification, and rollup state.
3. `npm run prisma:health` reports no unfinished or unknown migration.
4. Database connection use, locks, CPU, and latency remain within the planned envelope.
5. Queue oldest-age trends decline or remain normal across critical, general, bulk, and projection work.
6. Administrator/OIDC login, session refresh, and expected denied access work.
7. A synthetic incident is created/ingested, notified, acknowledged, and resolved.
8. At least one configured inbound provider and outbound notification provider succeeds.
9. Status-page publication, Jira/ChatOps projections, reports, and mobile routes used by your organization work.
10. Logs contain no sustained migration, serialization, provider, encryption, or authorization failures.

Keep the release in a monitored soak period that covers scheduled work and representative provider traffic. Record the image digest, schema result, test evidence, observed metrics, reviewer, and acceptance time.

## Operate the accepted release

Retain source and target digests, rendered configuration, migration output, acceptance evidence, and rollback criteria with the change record. Continue heightened monitoring through a representative paging and scheduled-maintenance window before retiring the previous image and backup.

## Failure handling

- **Migration fails:** stop rollout, preserve logs and database state, and follow [Migration fails](../../troubleshooting/upgrades/migration-fails.md).
- **New runtime fails before migration:** return to the old image/configuration.
- **New runtime fails after a compatible migration:** use the image-only rollback procedure.
- **New runtime fails after an incompatible migration or writes incompatible data:** stop writes and use the approved restore-based recovery path.
- **Only one projection/provider fails:** preserve canonical incident state, repair that subsystem, and decide whether the release-wide rollback trigger is met.

See [Roll back an upgrade](rollback.md) before executing any reversal.
