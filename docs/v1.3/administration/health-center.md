---
title: Administrator Health Center
description: Interpret database, migration, scheduler, escalation, delivery, backup, configuration, and version signals safely.
order: 8
---

# Administrator Health Center

Open **Settings → Health Center** as an application Admin. The page brings together operational signals available to the current OpsKnight instance. It complements external infrastructure monitoring and the per-incident timeline; it does not replace either.

## Status meanings

- **Healthy** means the signal passed its implemented check at the displayed time.
- **Needs attention** means the signal is available but delayed, inconsistent, failing at a limited rate, or behind the latest release.
- **Action required** means the check found a condition that can block or delay operations.
- **Not reported** means OpsKnight cannot verify the condition. Unknown is deliberately included in the overall attention state rather than converted to healthy.

Refresh after corrective work. The report is generated on demand and is not a durable monitoring time series.

## Checks

| Check | What it verifies | Important boundary |
| --- | --- | --- |
| Database | A live `SELECT 1` and response latency from this process. | Does not measure replicas, storage durability, locks, pool saturation, or backup state. |
| Database migrations | Failed migration records and packaged migration directories not recorded as applied. | Always review release migration logs; an old image can implement different startup behavior. |
| Scheduler and workers | Persisted scheduler heartbeat, next run, lock holder, and last error. | When internal cron is disabled, an external worker must be monitored separately. |
| Background jobs | Pending, processing, failed, overdue, and stale-processing counts. | Completed counts and historical latency require separate reporting. |
| Escalation backlog | Escalating incidents whose next step is due and stale processing locks. | Use the incident timeline to understand the selected policy, target, notification, and acknowledgement for one incident. |
| Notification providers | Enabled/configured providers plus recent failed or old-pending delivery records. | Configuration is not provider acceptance or human receipt; run a controlled end-to-end page. |
| Inbound integrations | Enabled integrations and process-local webhook error metrics. | Metrics reset on process restart and do not aggregate every replica; durable logs are authoritative. |
| Public URL | Database, `NEXT_PUBLIC_APP_URL`, and `NEXTAUTH_URL` origins and production HTTPS. | Reverse-proxy routing, DNS, certificates, and external reachability still need external probes. |
| Encryption | Presence and format of `ENCRYPTION_KEY`. | The page never displays the key or proves that every stored ciphertext can be decrypted. |
| Backup and restore evidence | Operator-reported backup and restore-test timestamps. | Timestamps are attestations, not independent validation of backup contents. |
| Version and upgrades | Current version compared with the public latest GitHub release. | Restricted networks can make the result unknown; review release notes before upgrading. |

## Report backup freshness

OpsKnight does not perform database backups. A backup controller or deployment pipeline can supply ISO-8601 timestamps to the application environment:

```dotenv
OPSKNIGHT_BACKUP_LAST_SUCCESS_AT=2026-08-23T12:00:00Z
OPSKNIGHT_RESTORE_TEST_LAST_SUCCESS_AT=2026-08-20T09:30:00Z
```

The page treats an unreported backup as unknown, a reported backup older than 24 hours as needing attention, and one older than 72 hours as action required. These generic thresholds do not override your recovery-point objective. Update the timestamp only after the backup system reports success; update the restore-test timestamp only after an isolated restore and application verification succeeds.

## Response order

1. Protect active response work and announce operational risk.
2. Address database and migration failures before application-level symptoms.
3. Recover stale schedulers, jobs, and escalation processing.
4. Investigate notification and integration errors with a synthetic incident.
5. Correct public URL or encryption configuration through a controlled deployment.
6. Verify backup evidence and restore capability outside the production database.
7. Review upgrade availability after the installation is stable.

## Related topics

- [Incident timeline and lifecycle](../core-concepts/incidents.md)
- [Notifications](./notifications.md)
- [System settings](./system-settings.md)
- [Monitoring](../deployment/monitoring.md)
- [Maintenance](../deployment/maintenance.md)
- [Backup and restore](../deployment/backup-restore.md)
- [Upgrade and rollback](../deployment/upgrade-rollback.md)
