---
order: 9
title: Maintenance
description: Operate scheduled work, retention, backups, upgrades, and recurring verification safely.
---

# Maintenance

OpsKnight performs time-based work in the application process by default. Maintenance must cover both infrastructure and product workflows: PostgreSQL health alone does not prove escalation, cleanup, rollups, or notifications are progressing.

## Internal scheduler

The scheduler starts unless `ENABLE_INTERNAL_CRON=false`. It coordinates workers through PostgreSQL state/locking and dynamically schedules pending work. Its duties include escalation and notification-related processing, token and expired rate-limit cleanup, SLA work, and metric-rollup maintenance.

Do not disable it on every replica. If you intentionally move job ownership, document which process runs it and monitor that process. After deployment, look for scheduler start and successful tick messages as well as repeated lock, query, or job errors.

## Retention settings

Admins configure retention and analytics windows in **Settings → System**. Code defaults are:

| Data/window                |  Default | Allowed range |
| -------------------------- | -------: | ------------: |
| Incidents                  | 730 days |  30–3650 days |
| Alerts                     | 365 days |   7–3650 days |
| System logs                |  90 days |    1–365 days |
| Metric rollups             | 365 days |  30–3650 days |
| Real-time analytics window |  90 days |    7–365 days |

Retention affects query bounds and scheduled rollup cleanup; it is not a substitute for a legal/compliance deletion review or database backup retention. Confirm behavior in the relevant UI/report after changing a value. Settings are cached briefly, so a change may not appear in every process immediately.

## Daily checks

- Readiness is healthy and database latency is within baseline.
- No application/container restart loop or failed migration message.
- Scheduler ticks and escalation work are progressing.
- Notification History has no unexplained systemic failure pattern.
- Inbound integration failures/rate limits remain within baseline.
- Database connections, storage, and backup jobs are healthy.

## Weekly checks

- Run a dedicated trigger/resolve synthetic incident and external notification.
- Review failed notification and webhook/provider errors.
- Review upcoming on-call schedules and temporary overrides.
- Check certificate, domain, provider credential, and API-token expiry/rotation dates.
- Confirm backup completion and copy integrity.

## Monthly or release-cycle checks

- Restore a recent database backup into an isolated environment with the matching `ENCRYPTION_KEY`.
- Review users, administrators, API keys, integrations, and audit activity.
- Review retention against policy and storage growth.
- Patch the host/cluster, PostgreSQL, proxy, and supported OpsKnight image through the tested upgrade workflow.
- Re-run critical role, incident, notification, status-page, and integration acceptance tests.

## Planned maintenance

1. Announce the window through an independent channel and, when appropriate, the status page.
2. Freeze risky configuration changes.
3. Record image/config versions and take a verified backup.
4. Drain or stop traffic according to the deployment method.
5. Apply the change and observe migration/startup logs.
6. Verify readiness, authentication, database writes, synthetic incident routing, and provider delivery.
7. Close the announcement only after the soak period succeeds.

## Recovery boundary

Application rollback and data rollback are different operations. A previous container image may not understand a migrated schema. Preserve the pre-change database recovery point and use release-specific migration guidance before rolling code backward.

## Related topics

- [Deployment](./README)
- [Docker Compose](./docker)
- [Monitoring](./monitoring)
- [Configuration Reference](../getting-started/configuration)
