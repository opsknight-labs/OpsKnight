---
order: 5
title: Data Retention
description: Manage data storage and automatic cleanup policies
---

# Data Retention

Data retention policies control how long OpsKnight stores historical data. Configure these settings to balance storage costs, performance, and compliance requirements.

---

## Overview

Retention policies help:

- **Reduce storage costs** — Automatically remove old data
- **Improve performance** — Smaller datasets mean faster queries
- **Meet compliance** — Retain data for required periods
- **Protect privacy** — Remove data after it's no longer needed

---

## Retention Settings

**Location**: **Settings** → **System** → **Data Retention**

**Requirements**: Admin role

| Data Type            | Setting                 | Default       | Description                            |
| -------------------- | ----------------------- | ------------- | -------------------------------------- |
| **Incidents**        | `incidentRetentionDays` | 730 (2 years) | Resolved incident records              |
| **Alerts**           | `alertRetentionDays`    | 365 (1 year)  | Raw alert events                       |
| **Logs**             | `logRetentionDays`      | 90 days       | Application log entries                |
| **Metrics**          | `metricsRetentionDays`  | 365 (1 year)  | Pre-aggregated metric rollups          |
| **Real-time Window** | `realTimeWindowDays`    | 90 days       | Period for real-time analytics queries |

---

## Presets

OpsKnight provides preconfigured presets for common use cases:

### Minimal (90 days)

| Setting          | Value   |
| ---------------- | ------- |
| Incidents        | 90 days |
| Alerts           | 30 days |
| Logs             | 14 days |
| Metrics          | 90 days |
| Real-time Window | 30 days |

**Best for**: Development environments, cost-sensitive deployments

### Standard (1 year)

| Setting          | Value    |
| ---------------- | -------- |
| Incidents        | 365 days |
| Alerts           | 180 days |
| Logs             | 30 days  |
| Metrics          | 365 days |
| Real-time Window | 60 days  |

**Best for**: Most production environments

### Extended (2 years)

| Setting          | Value    |
| ---------------- | -------- |
| Incidents        | 730 days |
| Alerts           | 365 days |
| Logs             | 90 days  |
| Metrics          | 730 days |
| Real-time Window | 90 days  |

**Best for**: Teams needing longer historical data

### Enterprise (5 years)

| Setting          | Value     |
| ---------------- | --------- |
| Incidents        | 1825 days |
| Alerts           | 730 days  |
| Logs             | 180 days  |
| Metrics          | 1825 days |
| Real-time Window | 90 days   |

**Best for**: Enterprise with extended retention needs

### Compliance (7 years)

| Setting          | Value     |
| ---------------- | --------- |
| Incidents        | 2555 days |
| Alerts           | 1825 days |
| Logs             | 365 days  |
| Metrics          | 2555 days |
| Real-time Window | 90 days   |

**Best for**: Organizations with regulatory requirements (SOX, HIPAA)

---

## Configuring Retention

### Via UI

1. Go to **Settings** → **System** → **Data Retention**
2. Select a preset or configure custom values
3. Click **Save**

### Via API

**Get current settings**:

```bash
GET /api/settings/retention
Authorization: Bearer YOUR_API_KEY
```

**Response**:

```json
{
  "policy": {
    "incidentRetentionDays": 730,
    "alertRetentionDays": 365,
    "logRetentionDays": 90,
    "metricsRetentionDays": 365,
    "realTimeWindowDays": 90
  },
  "stats": {
    "incidentCount": 1250,
    "alertCount": 45000,
    "logCount": 125000
  },
  "presets": [...]
}
```

**Update settings**:

```bash
PUT /api/settings/retention
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "incidentRetentionDays": 365,
  "alertRetentionDays": 180,
  "logRetentionDays": 30
}
```

---

## Data Cleanup

### Automatic Cleanup

OpsKnight runs automatic cleanup based on your retention settings. Data older than the configured retention period is permanently deleted.

### Manual Cleanup

Trigger cleanup manually for immediate effect:

1. Go to **Settings** → **System** → **Data Retention**
2. Click **Run Cleanup**
3. Choose **Dry Run** to preview or **Execute** to delete

### Via API

**Dry run** (preview what will be deleted):

```bash
POST /api/settings/retention
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "dryRun": true
}
```

**Execute cleanup**:

```bash
POST /api/settings/retention
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "dryRun": false
}
```

**Response**:

```json
{
  "success": true,
  "dryRun": false,
  "result": {
    "incidentsDeleted": 150,
    "alertsDeleted": 5000,
    "logsDeleted": 25000
  }
}
```

---

## What Gets Deleted

### Incident Data

When incidents exceed retention:

- Incident record
- Associated alerts
- Timeline events
- Notes
- Custom field values

### Alert Data

When alerts exceed retention:

- Raw alert payload
- Deduplication records

### Log Data

When logs exceed retention:

- Application log entries
- Debug information

### Metric Rollups

When metrics exceed retention:

- Daily/weekly/monthly aggregations
- Historical SLA snapshots

---

## Storage Statistics

View current storage usage:

1. Go to **Settings** → **System** → **Data Retention**
2. See **Storage Statistics** section

Statistics include:

- Total incident count
- Total alert count
- Total log count
- Data eligible for cleanup

---

## Compliance Considerations

### GDPR

- Set appropriate retention periods for personal data
- Export data before deletion if needed
- Document retention policies

### HIPAA

- Extended retention often required (7+ years)
- Use Compliance preset as starting point
- Ensure audit logs have sufficient retention

### SOC 2

- Maintain audit trails
- Document retention procedures
- Regular review of policies

---

## Best Practices

### Setting Retention

| Consideration           | Recommendation                           |
| ----------------------- | ---------------------------------------- |
| Compliance requirements | Check regulatory minimums first          |
| Storage costs           | Balance cost vs. historical data needs   |
| Analytics needs         | Keep enough for trend analysis           |
| Debugging               | Short retention for logs is usually fine |

### Before Reducing Retention

1. **Export critical data** — Download reports before cleanup
2. **Test with dry run** — Preview impact before executing
3. **Communicate** — Inform team of policy changes

### Real-time Window

The `realTimeWindowDays` setting affects analytics performance:

- Queries within this window use live data
- Queries beyond use pre-aggregated rollups
- Larger windows = slower queries but more accuracy
- Recommended: 60-90 days for most deployments

---

## Related Topics

- [Audit Logs](./audit-logs) — Audit log retention
- [Analytics](../core-concepts/analytics) — Historical data analysis
