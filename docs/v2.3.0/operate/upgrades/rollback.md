---
title: Roll back an upgrade
description: Select and execute an image, configuration, forward-fix, or restore recovery path without corrupting schema or losing hidden work.
type: deployment
product_area: upgrades
audience: [operator]
reader:
  status: READER_COMPLETE
  task: Select and execute the safest image, forward-fix, or restore recovery path.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - scripts/validate-migrations.cjs
    - scripts/check-migration-health.cjs
    - deploy/swarm/scripts/rollback.sh
    - deploy/swarm/scripts/health-check.sh
---

# Roll back an upgrade

Rollback is a compatibility decision, not simply selecting an older image. Application specifications can be reversed quickly; committed PostgreSQL migrations and new-version writes are not automatically reversed. Choose the least destructive recovery path that restores safe service.

## Prerequisites

Before every upgrade, retain:

- Previous immutable image digest and complete configuration.
- Migration compatibility assessment for the previous runtime on the new schema.
- Verified pre-upgrade backup plus matching encryption keys and secrets.
- Current and target schema/migration records.
- Rollback triggers, decision owner, RPO/RTO, and communication path.
- Commands for the exact Compose, Kubernetes/Helm/Kustomize, or Swarm topology.

If these are missing during an incident, pause writes and investigate rather than guessing that an image rollback is safe.

## Configure the recovery path

### Image/configuration rollback

Use when the previous application is explicitly compatible with the current database schema and no new data requires a newer interpretation. Restore the previous digest and configuration without reversing migrations.

### Forward fix

Use when the schema is healthy, data written by the new version must be preserved, and a reviewed patch can restore service faster and more safely than database recovery. Pin the fix by digest and apply the normal migration/verification controls.

### Stop writes and restore

Use when the previous runtime is incompatible with the migrated schema, the migration partially corrupted state, or new-version writes cannot be interpreted safely. This returns the database to the backup point and loses later writes within the approved RPO.

### Roll forward to a known-good newer release

Use only when that release explicitly supports the current schema and the team has validated its migration path and artifacts.

Do not improvise down-migrations, delete `_prisma_migrations` rows, edit applied SQL, or use destructive Prisma flags.

## Contain the failed rollout

1. Declare rollback/recovery and record the decision time.
2. Stop further rollout and configuration automation.
3. Preserve application, migration, database, ingress, and orchestrator logs.
4. Record running digests, replica states, current `deploymentId`, migration rows, and queue ages.
5. If schema/data compatibility is uncertain, stop Web and all write-capable background roles. Keep no mixed-version writer running.
6. Communicate user impact and expected recovery path.

## Image-only rollback by topology

### Docker Compose

Restore the previous digest and configuration, render the exact file set, and confirm no migration owner will run:

```bash
docker compose <files> config --quiet
docker compose <files> config --images
docker compose <files> pull
docker compose <files> up -d --wait
docker compose <files> ps -a
```

For split mode, ensure all long-running roles return to mutually compatible versions and still use `OPSKNIGHT_SKIP_MIGRATIONS=true`. Do not run the old image's migrations against a newer schema.

### Helm

Inspect release history and the candidate previous manifest:

```bash
helm history opsknight --namespace opsknight
helm get values opsknight --namespace opsknight --all
```

Use `helm rollback` only after confirming the historical image/configuration supports the current schema. Disable or prevent an old pre-upgrade migration hook from trying to reinterpret the newer migration state, then monitor rollout:

```bash
helm rollback opsknight <revision> --namespace opsknight --wait
kubectl -n opsknight rollout status deployment --timeout=10m
```

Review actual resource names and hooks for your release before running these commands.

### Kustomize or raw Kubernetes

Apply the previous reviewed manifests/digest without replaying old migrations. Roll back all coupled runtime roles, then wait for each Deployment and verify no stale migration Job is active.

### Docker Swarm

After schema compatibility is confirmed, run:

```bash
SWARM_STACK_NAME=opsknight ./deploy/swarm/scripts/rollback.sh
```

The script detects integrated or split services, requests Docker service rollback for application roles and PgBouncer when present, waits briefly, and invokes the Swarm health checker. It does not revert database migrations. A warning that a service has no previous specification requires an explicit digest deployment for that service.

## Restore-based recovery

When image-only rollback is unsafe:

1. Stop ingress and every application role that can write.
2. Preserve the failed database separately for investigation; do not overwrite the only copy.
3. Provision an isolated target database or follow the database provider's controlled point-in-time restore process.
4. Restore the last approved backup and the matching encryption key/keyring and application secrets.
5. Deploy the previous known-good image against the restored database.
6. Run migration health without applying unapproved new migrations.
7. Validate encrypted provider configuration, authentication, services, incidents, schedules, audit data, and background processing.
8. Switch traffic only after the recovered environment passes acceptance.
9. Reconcile or communicate data lost between the recovery point and write stop.

Follow [Back up and restore data](../data/backup-and-restore.md). Never restore production over the failed database before proving the backup is readable.

## Validation after rollback

Verify the same surfaces used to accept an upgrade:

- Every runtime role runs the intended previous digest and configuration.
- Readiness is healthy; deep health shows scheduler/worker ownership and normal queue ages.
- Migration health matches the chosen recovery path.
- Database connections, locks, latency, and errors stabilize.
- Login and authorization work, including a denied-path check.
- A synthetic incident completes create/ingest, notification, acknowledgement, and resolution.
- Inbound integrations, ChatOps/Jira/status projections, and mobile routes used in production work.
- No old or failed-new replica remains able to process jobs or writes.

Monitor through at least one scheduler interval and representative queue/provider cycle. Keep the incident open until delayed work and projections are understood.

## Troubleshooting

### The old application starts but readiness fails

Check schema compatibility, configuration/secret version, database connectivity, and runtime role. Stop repeated restarts if logs show unknown columns, enum values, or migration state; the image-only path may be invalid.

### Helm rollback re-runs an unsafe hook

Stop and inspect the historical chart hooks. Recover with a reviewed manifest/configuration that does not invoke the old migration owner against the current schema.

### Swarm reports no previous version

Deploy the recorded previous digest through the normal controlled deployment configuration after verifying schema compatibility. Do not assume every service retained a rollback specification.

### Queues grow after rollback

Confirm each lane has exactly the intended owner, old jobs remain compatible, provider credentials decrypt, and database connection capacity fits restored replica counts.

### Restore succeeds but integrations fail

Verify the matching encryption keyring and provider secrets were restored. Database data alone is insufficient for encrypted configuration.

## Operate after recovery

Record trigger, decision, digests, schema state, backup recovery point, lost/reconciled writes, commands, evidence, verification result, and follow-up actions. Preserve the failed artifacts for postmortem analysis and update the rehearsal so the same ambiguity cannot recur.

See [Upgrade OpsKnight](upgrade.md), [Database migrations](database-migrations.md), and [Migration troubleshooting](../../troubleshooting/upgrades/migration-fails.md).
