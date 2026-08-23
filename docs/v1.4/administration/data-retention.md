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

| Data set              |  Default | Accepted range | Effect                                                           |
| --------------------- | -------: | -------------: | ---------------------------------------------------------------- |
| Resolved incidents    | 730 days |       30–3,650 | Bounds history and selects old resolved incidents for cleanup.   |
| Unlinked alerts       | 365 days |        7–3,650 | Selects old alerts after retained-incident links are considered. |
| Stored log entries    |  90 days |          1–365 | Selects PostgreSQL `LogEntry` rows.                              |
| Metric rollups        | 365 days |       30–3,650 | Bounds historical metric queries and rollup cleanup.             |
| High-precision window |  90 days |          7–365 | Controls the live-data analytics window, not a separate archive. |

The server clamps out-of-range values. Internal endpoint users should read back the saved policy because the UI and server minimum for the high-precision window differ.

## Preset boundary

Minimal, Standard, Extended, Enterprise, and Compliance presets are convenience templates, not legal advice or certifications. Some labels summarize incident retention while alert and log windows are shorter.

## Preview and execute cleanup

Take and verify a database backup first. Then save the intended policy, select **Preview**, reconcile the predicted counts, and only then select **Execute** and confirm permanent deletion. Verify the result and refreshed statistics.

The settings route uses the signed-in browser session and requires `ADMIN`. It is an internal endpoint, not part of the published API-key contract.

## What cleanup actually removes

| Category      | Selection and action                                                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Incidents     | Deletes only `RESOLVED` incidents whose **creation time** predates the cutoff, after deleting timeline events, notes, and custom-field values. |
| Linked alerts | Detaches alerts from incidents selected for deletion.                                                                                          |
| Alerts        | Deletes alerts older than their cutoff only when no longer linked to an incident.                                                              |
| Logs          | Deletes old PostgreSQL `LogEntry` rows, not audit records or the System Logs memory buffer.                                                    |
| Metrics       | Deletes metric and SLA rollups older than the metric cutoff.                                                                                   |

Open incidents are not deleted. v1.4 does not copy deleted incidents to cold storage; its archive helper only reports candidates.

### Dry-run limitation

Preview reports incident, alert, and log candidates. It reports zero metrics and events even though execution may delete those records. It is a safety check, not a complete deletion manifest.

## Automatic schedule

The application scheduler runs this cleanup service on its cleanup job. See [Maintenance](../deployment/maintenance.md) for schedule, locking, and multi-replica behavior.

## Product effects

- **All Time** analytics can be clipped and display a retention notice.
- Incident deletion removes timeline, notes, and custom-field values.
- Public status and RSS history cannot show deleted records.
- Audit records and the per-process System Logs buffer are unaffected.

Before reducing a window, identify legal and reporting needs, restore-test a recent backup, export required data, reconcile Preview, notify data owners, observe execution, and verify analytics, status history, storage, and job logs.

If cleanup fails, preserve the error and check PostgreSQL health, application logs, and migration activity before retrying.

## Related topics

- [Maintenance](../deployment/maintenance.md)
- [Backup and restore](../deployment/docker.md#backup-and-restore-postgresql)
- [Audit logs](audit-logs.md)
- [System logs](system-logs.md)
- [Analytics](../core-concepts/analytics.md)
