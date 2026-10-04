---
title: Back up and restore data
description: Build a complete recovery set, produce PostgreSQL backups, rehearse isolated restores, and recover production safely.
type: deployment
product_area: data
audience: [operator, administrator]
keywords: [backup OpsKnight, restore backup, PostgreSQL backup, disaster recovery]
reader:
  status: READER_COMPLETE
  task: Produce, validate, rehearse, and restore a complete OpsKnight recovery set.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/scripts/drills/verify-backup-restore.sh
    - prisma/schema.prisma
    - scripts/check-migration-health.cjs
---

# Back up and restore data

A recoverable OpsKnight backup is a matched recovery set: PostgreSQL data, the exact encryption/authentication secrets needed to interpret it, deployment configuration, and a known-compatible immutable application image. A database dump alone is not a proven recovery.

## Prerequisites and recovery objectives

Before choosing a backup method, document:

- Recovery point objective (RPO): maximum acceptable lost writes.
- Recovery time objective (RTO): maximum acceptable time to restore service.
- Backup and restore owners, including after-hours access.
- Storage location, encryption, retention, deletion protection, and failure-domain separation.
- Whether point-in-time recovery, logical dumps, storage snapshots, or a combination is required.
- The acceptance journey that proves restored service.

Logical dumps are portable and inspectable but may not meet a low RPO by themselves. Managed PostgreSQL continuous backup/PITR can reduce RPO, but still needs restore rehearsal and the matching OpsKnight secrets.

## Configure the recovery inventory

Protect and version these together:

- A transactionally consistent PostgreSQL backup or provider recovery point.
- `ENCRYPTION_KEY` or the complete `ENCRYPTION_KEYS` keyring needed by retained records.
- `NEXTAUTH_SECRET`, API-key/authentication secrets, SCIM token, and other stable runtime secrets required by the installation.
- Database endpoints, CA certificates, users/roles, and network policy needed for recovery.
- Compose files/environment, Helm values, Kustomize overlays, or Swarm configuration without exposing secrets in ordinary source artifacts.
- Exact application and PgBouncer image digests.
- Ingress hostname/TLS ownership, OIDC client configuration, and external provider credentials not stored in OpsKnight.
- Any external file/object storage actually enabled by your deployment.

Store database backups separately from the application host/cluster and store recovery keys through a separately controlled secret-recovery process. Test that authorized responders can obtain both during an incident without placing them in the same compromise domain.

## Produce a logical backup

Use a PostgreSQL client version compatible with the server. Prefer custom format for flexible `pg_restore` behavior:

```bash
umask 077
pg_dump "$DIRECT_DATABASE_URL" \
  --format=custom \
  --no-owner \
  --file=opsknight-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Capture exit status, file size, checksum, PostgreSQL server/client versions, database identity, backup start/end time, current image digest, and latest application/migration markers in protected backup metadata. Do not print the database URL or secrets into logs.

### Docker Compose bundled PostgreSQL

Use the actual database/user values from the deployed environment:

```bash
umask 077
docker compose <files> exec -T opsknight-db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner \
  > opsknight-backup.dump
test -s opsknight-backup.dump
```

Transfer the result to protected storage after verifying the command succeeded. The named Compose volume is persistence on the same host, not an independent backup.

### Kubernetes or Helm bundled PostgreSQL

Identify the PostgreSQL Pod and stream the dump outside the cluster failure domain:

```bash
kubectl -n opsknight get pods
umask 077
kubectl -n opsknight exec POD_NAME -- \
  pg_dump -U opsknight -d opsknight_db --format=custom --no-owner \
  > opsknight-backup.dump
test -s opsknight-backup.dump
```

Replace names with the rendered release values. A PVC snapshot is acceptable only when the storage/database procedure guarantees PostgreSQL consistency and its restore has been tested. The shipped bundled database is not a substitute for provider-grade high availability.

### Managed or external PostgreSQL

Use the provider's supported snapshot/PITR workflow and keep a logical dump when portability or independent validation is required. Record the region/account/project, recovery timestamp or log position, retention window, encryption key ownership, and exact restore procedure. Confirm a restore does not automatically expose the recovered database to production writers.

## Validate backup artifacts

At creation time:

1. Require successful backup-job exit status.
2. Require a non-empty artifact and store a cryptographic checksum.
3. Alert on missed schedules, age beyond RPO, unexpected size change, upload failure, or retention deletion failure.
4. Verify the secret/key recovery set exists without copying secret values into the backup report.
5. Periodically list the archive (`pg_restore --list`) and perform a full isolated restore. Listing is not a restore test.

## Run the repository restore drill

The supplied drill accepts plain SQL, gzip-compressed SQL, or custom-format dumps and restores into an isolated PostgreSQL 15 container:

```bash
deploy/scripts/drills/verify-backup-restore.sh \
  /absolute/path/to/opsknight-backup.dump
```

It creates an ephemeral database, restores with fail-fast options, and checks the migration, incident, and user tables. A passing script proves structural readability of the database artifact; it does not prove secrets decrypt, external providers work, or the full application meets RTO.

## Perform an application-level restore rehearsal

Use an isolated network/database with no route from production integrations:

1. Provision an empty database compatible with the source PostgreSQL version.
2. Restore the dump:

   ```bash
   createdb opsknight_restore
   pg_restore --exit-on-error --no-owner --no-privileges \
     --dbname=opsknight_restore opsknight-backup.dump
   ```

3. Restore the matching encryption keyring and stable secrets into an isolated secret scope.
4. Deploy the recorded immutable OpsKnight image. Prevent real notification/webhook delivery by using controlled test providers or blocked egress.
5. Run migration health before applying any newer migrations:

   ```bash
   DIRECT_DATABASE_URL="$RESTORE_DATABASE_URL" npm run prisma:health
   ```

6. Start one runtime instance and inspect startup, decryption, and schema logs.
7. Expand to the intended roles only after the first instance is healthy.

## Acceptance checklist

Verify and record:

- Migration history has no unfinished or unknown entry.
- Administrator and normal responder sign-in behave correctly; expected denied access still fails.
- Users, teams, services, schedules, policies, incidents, notes, custom fields, postmortems, action items, status pages, and audit history are present.
- Encrypted notification/integration credentials can be read; use controlled provider tests.
- Scheduler and every worker lane owns and processes work without duplicate owners.
- One uniquely keyed synthetic incident creates, deduplicates as expected, notifies a controlled destination, acknowledges, and resolves.
- Status projection, reports, API authentication, and mobile access used by the organization work.
- The newest recovered business record establishes actual RPO; elapsed restore-to-acceptance time establishes actual RTO.

Save reviewer, date, source and image revision, backup identifier/checksum, recovered timestamp, duration, results, and logs/screenshots in an access-controlled evidence location.

## Run a production restore

1. Declare the recovery incident, identify the approved recovery point, and stop ingress plus every write-capable Web/worker/scheduler/projector role.
2. Preserve the failed/current database separately for forensic or reconciliation needs.
3. Restore into an empty replacement database or use the provider's controlled PITR target rather than overwriting the only current copy.
4. Restore the matching secret/key versions and configuration.
5. Deploy the known-compatible immutable image and run migration health.
6. Start one instance with outbound side effects constrained; run the acceptance checklist.
7. Start remaining roles, verify exactly one supported scheduler ownership model, and watch queue age and provider delivery.
8. Switch traffic only after approval, then reconcile or communicate writes lost after the recovery point.
9. Protect the recovered baseline and retain recovery evidence for postmortem review.

`pg_restore --clean --if-exists` is destructive. Use it only against an explicitly verified recovery target after preserving its current state.

## Production considerations and key-loss boundaries

- Missing `ENCRYPTION_KEY`/keyring: encrypted provider and integration values may be unreadable even though ordinary relational data exists. Restore the matching key or re-enter affected credentials; do not delete evidence while diagnosing.
- Changed `NEXTAUTH_SECRET`: existing sessions/tokens may be invalidated. Plan forced reauthentication.
- Missing external OAuth/webhook credentials: reconnect or rotate at the provider and OpsKnight.
- Wrong image/schema pairing: stop rather than letting an old runtime write to an incompatible restored schema.

## Troubleshooting

### `pg_restore` reports ownership or privilege errors

Use `--no-owner --no-privileges` with a restore principal permitted to create required schema objects. Do not broadly grant production superuser access as a shortcut.

### The restore has missing relations

Confirm the artifact is complete, target database was empty, restore exited successfully, and the correct database/schema was selected. Compare `pg_restore --list` with the restore log.

### The application starts but integrations fail to decrypt

Verify the exact key/keyring version from backup time and secret formatting. Do not rotate or overwrite encrypted values until recovery is understood.

### The restored scheduler or workers do not progress

Check runtime roles, migrations, direct database connectivity, leases, pending-job age, and whether isolation intentionally blocks provider egress. Confirm only intended owners are running.

### The backup exceeds RPO or restore exceeds RTO

Shorten backup/PITR intervals, reduce artifact transfer/restore bottlenecks, pre-stage compatible images and tooling, and rehearse more frequently. Do not change the declared objective merely to make a failed drill pass.

## Related pages

- [Database migrations](../upgrades/database-migrations.md)
- [Upgrade](../upgrades/upgrade.md)
- [Rollback](../upgrades/rollback.md)
- [Security hardening](../security/hardening.md)
- [Maintenance and retention](maintenance-and-retention.md)
