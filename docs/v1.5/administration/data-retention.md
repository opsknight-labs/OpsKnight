---
order: 5
title: Data Retention
description: Configure query windows and permanently remove eligible historical data.
---

# Data Retention

Retention settings bound historical queries and control the built-in cleanup job. Cleanup is destructive: choose values from business, investigation, backup, and legal requirements—not from a preset name alone.

## Configure retention

You need the **ADMIN** role.

1. Go to **Settings** → **System** → **Data Retention**.
2. Review the counts and oldest-record dates.
3. Select a preset or enter each value in days.
4. Select **Save Changes**.

Presets only populate the form; they do not run cleanup. **Reset to Defaults** also changes the form without saving it.

| Data set              |  Default | Accepted range | Effect                                                                                 |
| --------------------- | -------: | -------------: | -------------------------------------------------------------------------------------- |
| Resolved incidents    | 730 days |       30–3,650 | Bounds history and selects eligible old resolved incidents for cleanup.                |
| Alerts                | 365 days |        7–3,650 | Selects raw alerts older than the alert cutoff.                                        |
| Audit & event history | 365 days |        1–3,650 | Selects `AuditLog`, `IncidentEvent`, `LogEntry`, and in-app notification records.     |
| Metric rollups        | 365 days |       30–3,650 | Bounds historical metric queries and rollup cleanup.                                   |
| Live analytics window |  90 days |          7–365 | Controls the live-data analytics window, not a separate archive.                       |

The UI and server enforce the same ranges. Requests outside those ranges are rejected rather than silently changed.

## Preset boundary

Minimal, Standard, Extended, Enterprise, and Compliance presets are convenience templates, not legal advice or certifications. Audit and event history is retained for 14 days, 1 year, 2 years, 5 years, and 7 years respectively. The server supports up to 10 years (3,650 days).

New installations and new `SystemSettings` records default Audit & Event History to one year. Existing saved settings are deliberately left unchanged; an administrator must select a preset or save the desired value.

## Preview and execute cleanup

Take and verify a database backup first. Then save the intended policy, select **Preview**, reconcile the predicted counts, and only then select **Execute** and confirm permanent deletion. Verify the result and refreshed statistics.

The settings route uses the signed-in browser session and requires `ADMIN`. It is an internal endpoint, not part of the published API-key contract.

## What cleanup actually removes

| Category              | Selection and action                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incidents             | Deletes only eligible `RESOLVED` incidents whose **creation time** predates the cutoff, after deleting dependent timeline events, notes, and custom-field values. |
| Incident-event safety | An incident is not eligible while it still has an event inside the configured Audit & Event History period.                                                       |
| Alerts                | Deletes raw alerts older than their alert cutoff.                                                                                                                |
| Audit & event history | Deletes expired `AuditLog`, `IncidentEvent`, PostgreSQL `LogEntry`, and in-app notification rows in bounded batches.                                             |
| Metrics               | Deletes metric and SLA rollups older than the metric cutoff.                                                                                                     |

Open incidents are not deleted. OpsKnight does not copy deleted incidents to cold storage; its archive helper only reports candidates.

### Dry-run limitation

Preview reports incident, alert, stored-log, audit-log, and incident-event candidates. It reports zero metrics and notification candidates. It is a safety check, not a complete deletion manifest.

## Automatic schedule

The application scheduler runs this cleanup service on its cleanup job. See [Maintenance](../deployment/maintenance.md) for schedule, locking, and multi-replica behavior.

## Product effects

- **All Time** analytics can be clipped and display a retention notice.
- Incident deletion removes timeline, notes, and custom-field values.
- Public status and RSS history cannot show deleted records.
- Audit records and incident events are removed when their Audit & Event History period expires; the per-process System Logs buffer is unaffected.

Before reducing a window, identify legal and reporting needs, restore-test a recent backup, export required data, reconcile Preview, notify data owners, observe execution, and verify analytics, status history, storage, and job logs. OpsKnight does not provide a legal hold or immutable archive, so preserve records subject to either requirement outside the cleanup path first.

If cleanup fails, preserve the error and check PostgreSQL health, application logs, and migration activity before retrying.

## Related topics

- [Maintenance](../deployment/maintenance.md)
- [Backup and restore](../deployment/docker.md#backup-and-restore-postgresql)
- [Audit logs](audit-logs.md)
- [System logs](system-logs.md)
- [Analytics](../core-concepts/analytics.md)
