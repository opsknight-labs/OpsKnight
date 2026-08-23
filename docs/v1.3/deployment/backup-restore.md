---
order: 7
title: Backup and Restore
description: Back up PostgreSQL and critical secrets, restore safely, and prove application recovery
---

# Backup and Restore

A recoverable OpsKnight backup consists of PostgreSQL plus the secrets and deployment configuration required to interpret its data. A database dump without the matching `ENCRYPTION_KEY` cannot recover stored provider and integration credentials.

## Recovery set

Back up these items together:

- a transactionally consistent PostgreSQL backup;
- `ENCRYPTION_KEY` and `NEXTAUTH_SECRET` from the production secret store;
- database connection and authentication configuration;
- Compose configuration, Kubernetes overlays/manifests, or Helm values and the chart/application version;
- ingress domains/TLS ownership and the exact application image tag or digest;
- external provider credentials that are not stored in OpsKnight.

Keep backup copies outside the application host/cluster failure domain. Encrypt them, restrict restore access, monitor backup jobs, define retention, and test restoration regularly.

## Docker Compose backup

The shipped database service is `opsknight-db`, with database/user defaults of `opsknight_db` and `opsknight`. Override them when your `.env` differs.

```bash
docker compose exec -T opsknight-db \
  pg_dump -U opsknight -d opsknight_db --format=custom --no-owner \
  > opsknight-backup.dump
```

Check that the command exits successfully and the output is non-empty, then transfer it to the protected backup destination. A named Docker volume is persistent storage, not an independent backup.

## Kubernetes or Helm backup

For the supplied in-cluster PostgreSQL, identify the database pod and stream a custom-format dump to the operator workstation or backup agent:

```bash
kubectl get pods -n opsknight
kubectl exec -n opsknight POD_NAME -- \
  pg_dump -U opsknight -d opsknight_db --format=custom --no-owner \
  > opsknight-backup.dump
```

The supplied database StatefulSet is a single PostgreSQL instance. PVC snapshots are useful only when coordinated for PostgreSQL consistency and tested with your storage driver. For managed/external PostgreSQL, use the provider's point-in-time recovery and logical-backup controls and record who owns restore execution.

## Restore rehearsal

Restore first into an empty, isolated database with no production traffic:

```bash
createdb opsknight_restore
pg_restore --exit-on-error --no-owner --dbname=opsknight_restore opsknight-backup.dump
```

Use compatible PostgreSQL client/server versions and a principal that can create all required schema objects. Point an isolated OpsKnight instance at the restored database using the backed-up `ENCRYPTION_KEY` and `NEXTAUTH_SECRET`.

Verify all of the following:

- migration health reports no failed or unknown migrations;
- an administrator and a normal responder can sign in as expected;
- users, teams, services, schedules, policies, incidents, notes, postmortems, status pages, and audit records are present;
- OIDC, Slack, Jira, and notification-provider credentials decrypt and can be tested safely;
- an inbound synthetic alert creates, deduplicates, and resolves the intended incident;
- the scheduler and outbound notifications operate after recovery.

Record restore duration and the newest restored record so recovery-time and recovery-point objectives are measured rather than assumed.

## Production restore

1. Declare the incident and freeze application writes.
2. Preserve a forensic/current-state backup before overwriting anything.
3. Confirm the chosen recovery point, application image, schema compatibility, and secret versions.
4. Restore into an empty replacement database when possible.
5. Run migration health checks before routing application traffic.
6. Start one application instance, inspect startup/migration logs, and perform the acceptance checks.
7. Scale out and restore traffic only after the isolated checks pass.

For an in-place Compose restore, stop `opsknight-app` first. `pg_restore --clean --if-exists` is destructive and should target only the explicitly verified OpsKnight database after preserving its current state.

## Key-loss boundary

If PostgreSQL is recovered but `ENCRYPTION_KEY` is lost, ordinary data remains present but encrypted credentials cannot be decrypted. Configure a new key and re-enter every affected credential. If `NEXTAUTH_SECRET` is lost or changed, expect existing authentication tokens/sessions and API-key hash compatibility to be affected; follow the authentication and API-key rotation guidance.

## Related topics

- [Database migrations](./database-migrations)
- [Upgrade and rollback](./upgrade-rollback)
- [Encryption](../security/encryption)
- [Authentication](../administration/authentication)
- [Maintenance](./maintenance)
