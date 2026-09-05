---
title: Administrator Health Center
description: Interpret database, migration, scheduler, escalation, delivery, performance, configuration, and version signals safely.
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

| Check                         | What it verifies                                                                                                                              | Important boundary                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                      | A live `SELECT 1` and response latency from this process.                                                                                     | Does not measure replicas, storage durability, locks, pool saturation, or backup state.                                                                              |
| Database capacity             | Current database size, used/active connections, configured connection ceiling, and transactions open longer than five minutes.                | PostgreSQL statistics can be permission-limited. Host CPU, memory, disk capacity, replicas, and application pool waits require external telemetry.                   |
| Database migrations           | Failed migration records and packaged migration directories not recorded as applied.                                                          | Always review release migration logs; an old image can implement different startup behavior.                                                                         |
| Scheduler and workers         | Persisted scheduler heartbeat, next run, lock holder, and last error.                                                                         | When internal cron is disabled, an external worker must be monitored separately.                                                                                     |
| Background jobs               | Pending, processing, failed, overdue, and stale-processing counts.                                                                            | Completed counts and historical latency require separate reporting.                                                                                                  |
| SLA query performance         | Query count, average, p50, p95, slow-query count, incident-count context, and live/rollup/hybrid path breakdowns for the last 1 and 24 hours. | This measures real SLA calculation requests without synthetic probes; it is not database, host, or full-request APM. No traffic is reported as unknown, not healthy. |
| Escalation backlog            | Escalating incidents whose next step is due and stale processing locks.                                                                       | Use the incident timeline to understand the selected policy, target, notification, and acknowledgement for one incident.                                             |
| Paging configuration coverage | Services missing an escalation policy or using a policy with no steps.                                                                        | This verifies stored configuration, not current schedule coverage, provider acceptance, or human receipt; run a controlled test incident.                            |
| Notification providers        | Enabled/configured providers plus recent failed or old-pending delivery records.                                                              | Configuration is not provider acceptance or human receipt; run a controlled end-to-end page.                                                                         |
| Inbound integrations          | Enabled integrations and process-local webhook error metrics.                                                                                 | Metrics reset on process restart and do not aggregate every replica; durable logs are authoritative.                                                                 |
| Public URL                    | Database, `NEXT_PUBLIC_APP_URL`, and `NEXTAUTH_URL` origins and production HTTPS.                                                             | Reverse-proxy routing, DNS, certificates, and external reachability still need external probes.                                                                      |
| Encryption                    | Presence and format of `ENCRYPTION_KEY`.                                                                                                      | The page never displays the key or proves that every stored ciphertext can be decrypted.                                                                             |
| Version and upgrades          | Current version compared with the public latest GitHub release.                                                                               | Restricted networks can make the result unknown; review release notes before upgrading.                                                                              |

## Backup boundary

OpsKnight does not claim to verify deployment backups from inside the application. PostgreSQL may be bundled, operator-managed, or supplied by a cloud service, so backup scheduling, retention, encryption, monitoring, and restore evidence belong to the deployment owner. Follow the backup runbook and the controls of the database platform in use.

## Response order

1. Protect active response work and announce operational risk.
2. Address database and migration failures before application-level symptoms.
3. Recover stale schedulers, jobs, and escalation processing.
4. Investigate notification and integration errors with a synthetic incident.
5. Correct public URL or encryption configuration through a controlled deployment.
6. Verify backup and restore capability through the deployment's database platform.
7. Review upgrade availability after the installation is stable.

## Related topics

- [Incident timeline and lifecycle](../core-concepts/incidents.md)
- [Notifications](./notifications.md)
- [System settings](./system-settings.md)
- [Monitoring](../deployment/monitoring.md)
- [Maintenance](../deployment/maintenance.md)
- [Backup and restore](../deployment/backup-restore.md)
- [Upgrade and rollback](../deployment/upgrade-rollback.md)
