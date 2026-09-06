---
order: 10
title: Analytics
description: Comprehensive incident analytics, performance metrics, and operational insights
---

# Analytics

Analytics provide deep visibility into incident patterns, team performance, and operational health. Use these insights to identify trends, optimize response processes, and demonstrate SLA compliance.


---

## Why Analytics Matter

| Without Analytics          | With Analytics            |
| -------------------------- | ------------------------- |
| Blind to patterns          | Data-driven decisions     |
| Can't prove SLA compliance | Objective SLA tracking    |
| Unknown team workload      | Fair on-call distribution |
| Reactive improvements      | Proactive optimization    |

---

## Accessing Analytics

Navigate to **Analytics** in the sidebar to access:

- **Dashboard**: Overview of key metrics
- **Incidents**: Detailed incident analysis
- **On-Call**: Responder performance metrics
- **SLA**: Compliance tracking
- **Reports**: Exportable summaries

---

## Key Metrics

OpsKnight tracks 19+ metrics across incidents, response times, and SLA compliance.

### Response Time Metrics

#### MTTA (Mean Time to Acknowledge)

Average time from incident creation to first acknowledgment.

| Rating        | MTTA         | Interpretation             |
| ------------- | ------------ | -------------------------- |
| 🟢 Excellent  | < 5 minutes  | Rapid response             |
| 🟡 Acceptable | 5–15 minutes | Room for improvement       |
| 🔴 Needs Work | > 15 minutes | Review escalation policies |

**Calculation**: Sum of (acknowledgment time - creation time) / acknowledged incidents

#### MTTR (Mean Time to Resolve)

Average time from incident creation to resolution.

| Rating        | MTTR          | Interpretation             |
| ------------- | ------------- | -------------------------- |
| 🟢 Excellent  | < 30 minutes  | Efficient resolution       |
| 🟡 Acceptable | 30–60 minutes | Typical for complex issues |
| 🔴 Needs Work | > 60 minutes  | Review processes           |

**Calculation**: Sum of (resolution time - creation time) / resolved incidents

#### MTTE (Mean Time to Escalate)

Average time before incidents escalate beyond the first responder.

| Rating     | MTTE         | Interpretation                                 |
| ---------- | ------------ | ---------------------------------------------- |
| 🟢 Healthy | > 15 minutes | Primary responders handling most issues        |
| 🟡 Monitor | 5–15 minutes | Moderate escalation rate                       |
| 🔴 Review  | < 5 minutes  | Check if first-level needs more training/tools |

### Volume Metrics

| Metric              | Description                             |
| ------------------- | --------------------------------------- |
| **Total Incidents** | Count of incidents in the period        |
| **Open Incidents**  | Currently unresolved incidents          |
| **Acknowledged**    | Incidents acknowledged but not resolved |
| **Resolved**        | Incidents marked resolved               |
| **Snoozed**         | Incidents temporarily muted             |
| **Suppressed**      | Incidents auto-suppressed by rules      |

### Distribution Metrics

| Metric         | Description                  |
| -------------- | ---------------------------- |
| **By Urgency** | Breakdown by HIGH/MEDIUM/LOW |
| **By Service** | Incidents per service        |
| **By Team**    | Incidents per owning team    |
| **By Source**  | Incidents per integration    |
| **By Hour**    | Hourly distribution pattern  |
| **By Day**     | Daily distribution pattern   |

---

## SLA Metrics

### SLA Compliance Rate

Percentage of incidents resolved within SLA targets.

```
SLA Compliance = (Incidents within SLA / Total Resolved Incidents) × 100
```

### Per-Urgency SLA Tracking

| Urgency    | Default Target                                | Metric       |
| ---------- | --------------------------------------------- | ------------ |
| **HIGH**   | 15 minutes to acknowledge, 1 hour to resolve  | Compliance % |
| **MEDIUM** | 30 minutes to acknowledge, 4 hours to resolve | Compliance % |
| **LOW**    | 2 hours to acknowledge, 24 hours to resolve   | Compliance % |

### SLA Breach Analysis

Track which services and teams breach SLA most frequently:

| Analysis                | Purpose                       |
| ----------------------- | ----------------------------- |
| **Breaches by Service** | Identify problematic services |
| **Breaches by Team**    | Spot training/staffing needs  |
| **Breach Trends**       | Monitor improvement over time |
| **Near-Miss Tracking**  | Incidents close to breaching  |

---

## Dashboard Visualizations

OpsKnight provides 15+ visualization types for incident data.

### Time-Series Charts

| Chart                    | Shows                           |
| ------------------------ | ------------------------------- |
| **Incident Volume**      | Incidents over time (line/bar)  |
| **MTTA Trend**           | Acknowledgment time over time   |
| **MTTR Trend**           | Resolution time over time       |
| **SLA Compliance Trend** | Compliance percentage over time |


### Distribution Charts

| Chart              | Shows                                   |
| ------------------ | --------------------------------------- |
| **By Urgency**     | Pie/donut chart of urgency distribution |
| **By Status**      | Current status breakdown                |
| **By Service**     | Top services by incident count          |
| **By Team**        | Team workload comparison                |
| **By Hour of Day** | When incidents occur most               |
| **By Day of Week** | Daily patterns                          |

### Heatmaps

| Heatmap               | Shows                               |
| --------------------- | ----------------------------------- |
| **Hour × Day**        | When incidents peak                 |
| **Service × Urgency** | Which services have critical issues |
| **Team × Service**    | Coverage overlap                    |

### Tables

| Table               | Shows                             |
| ------------------- | --------------------------------- |
| **Top Incidents**   | Longest-running or most impactful |
| **Top Services**    | Services with most incidents      |
| **Top Responders**  | Most active incident handlers     |
| **Recent Breaches** | SLA violations                    |

---

## Filtering & Drill-Down

### Available Filters

| Filter         | Options                                           |
| -------------- | ------------------------------------------------- |
| **Time Range** | Last 24h, 7d, 30d, 90d, custom range              |
| **Service**    | Single or multiple services                       |
| **Team**       | Single or multiple teams                          |
| **Assignee**   | Specific responders                               |
| **Status**     | OPEN, ACKNOWLEDGED, RESOLVED, SNOOZED, SUPPRESSED |
| **Urgency**    | HIGH, MEDIUM, LOW                                 |
| **Source**     | Integration that created the incident             |

### Quick Filters

| Quick Filter     | Description                       |
| ---------------- | --------------------------------- |
| **My Incidents** | Incidents assigned to you         |
| **My Teams**     | Incidents for teams you belong to |
| **SLA Breached** | Only breached incidents           |
| **Unassigned**   | Incidents without an assignee     |

### Comparison Mode

Compare metrics across different periods:

```
This Week vs Last Week
This Month vs Last Month
This Quarter vs Last Quarter
```

Comparison shows:

- Percentage change
- Absolute difference
- Trend direction (↑ improving, ↓ declining)

---

## Reports

### Executive Summary Report

High-level overview for stakeholders.

**Includes**:

- Total incidents by urgency
- Overall SLA compliance
- MTTA and MTTR averages
- Top 5 affected services
- Period-over-period comparison
- Trend indicators

**Schedule**: Daily, weekly, or monthly delivery via email

### On-Call Performance Report

Responder-focused metrics.

**Includes**:
| Metric | Description |
| ------ | ----------- |
| **Incidents Handled** | Count per responder |
| **Average Response Time** | Per-responder MTTA |
| **Escalation Rate** | How often they escalate |
| **Resolution Rate** | Percentage resolved without escalation |
| **Night/Weekend Load** | Out-of-hours incident burden |

### Service Health Report

Service-focused analysis.

**Includes**:
| Metric | Description |
| ------ | ----------- |
| **Incident Count** | Total incidents per service |
| **MTTR by Service** | Resolution time per service |
| **SLA Compliance** | Per-service SLA tracking |
| **Top Incident Types** | Common issues per service |
| **Uptime Percentage** | Calculated availability |

### Team Workload Report

Team capacity planning.

**Includes**:
| Metric | Description |
| ------ | ----------- |
| **Incidents per Member** | Workload distribution |
| **Cross-Team Escalations** | Collaboration patterns |
| **Peak Hours** | When teams are busiest |
| **Coverage Gaps** | Periods without coverage |

---

## Exporting Data

### Export Formats

| Format   | Use Case                               |
| -------- | -------------------------------------- |
| **CSV**  | Spreadsheet analysis, custom reporting |
| **JSON** | Integration with other tools           |
| **PDF**  | Stakeholder presentations              |

### Export Options

1. Go to **Analytics**
2. Apply desired filters
3. Click **Export**
4. Select format
5. Choose data scope:
   - **Current View**: Only visible data
   - **Full Dataset**: All data matching filters
6. Download file

### Scheduled Exports

Set up recurring exports:

1. Go to **Analytics → Reports**
2. Click **Schedule Report**
3. Configure:
   - Report type
   - Filters
   - Format
   - Recipients (email)
   - Schedule (daily/weekly/monthly)

---

## API Access

### Analytics API Endpoints

| Endpoint                       | Description                |
| ------------------------------ | -------------------------- |
| `GET /api/analytics/summary`   | Overview metrics           |
| `GET /api/analytics/incidents` | Incident data with filters |
| `GET /api/analytics/mtta`      | MTTA metrics               |
| `GET /api/analytics/mttr`      | MTTR metrics               |
| `GET /api/analytics/sla`       | SLA compliance data        |

### Query Parameters

| Parameter    | Description       | Example                  |
| ------------ | ----------------- | ------------------------ |
| `start_date` | Period start      | `2024-01-01`             |
| `end_date`   | Period end        | `2024-01-31`             |
| `service_id` | Filter by service | `svc_abc123`             |
| `team_id`    | Filter by team    | `team_xyz`               |
| `urgency`    | Filter by urgency | `HIGH`                   |
| `group_by`   | Aggregation key   | `service`, `team`, `day` |

### Example Request

```bash
curl -X GET "https://your-opsknight.com/api/analytics/summary?start_date=2024-01-01&end_date=2024-01-31" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### Example Response

```json
{
  "period": {
    "start": "2024-01-01T00:00:00Z",
    "end": "2024-01-31T23:59:59Z"
  },
  "metrics": {
    "total_incidents": 156,
    "mtta_minutes": 4.2,
    "mttr_minutes": 28.5,
    "sla_compliance": 94.2,
    "by_urgency": {
      "HIGH": 23,
      "MEDIUM": 87,
      "LOW": 46
    },
    "by_status": {
      "RESOLVED": 148,
      "OPEN": 5,
      "ACKNOWLEDGED": 3
    }
  }
}
```

---

## Dashboard Customization

### Creating Custom Dashboards

1. Go to **Analytics → Dashboards**
2. Click **Create Dashboard**
3. Add widgets:
   - Drag from widget library
   - Configure data source and filters
   - Set visualization type
4. Arrange layout
5. Save dashboard

### Widget Types

| Widget           | Configuration                |
| ---------------- | ---------------------------- |
| **Metric Card**  | Single number with trend     |
| **Time Series**  | Line/bar chart over time     |
| **Distribution** | Pie/donut/bar chart          |
| **Table**        | Sortable data grid           |
| **Heatmap**      | Two-dimensional pattern view |
| **Text**         | Markdown annotations         |

### Sharing Dashboards

| Share Option     | Description               |
| ---------------- | ------------------------- |
| **Team Access**  | Visible to team members   |
| **Organization** | Visible to all users      |
| **Public Link**  | Shareable URL (read-only) |
| **Embed**        | iFrame embed code         |

---

## Alerting on Metrics

Set up alerts when metrics cross thresholds.

### Alert Conditions

| Condition           | Example                      |
| ------------------- | ---------------------------- |
| **MTTA exceeds**    | Alert if MTTA > 10 minutes   |
| **MTTR exceeds**    | Alert if MTTR > 1 hour       |
| **SLA drops below** | Alert if compliance < 95%    |
| **Volume spikes**   | Alert if incidents > 50/hour |

### Alert Configuration

1. Go to **Analytics → Alerts**
2. Click **Create Alert**
3. Configure:
   - Metric to monitor
   - Threshold value
   - Evaluation window
   - Notification channels

---

## Best Practices

### Regular Review Cadence

| Cadence       | Focus                                   |
| ------------- | --------------------------------------- |
| **Daily**     | Open incidents, SLA breaches            |
| **Weekly**    | MTTA/MTTR trends, team workload         |
| **Monthly**   | Service health, pattern analysis        |
| **Quarterly** | Capacity planning, process improvements |

### Metric Interpretation

- **Look at trends**, not just snapshots
- **Compare similar periods** (weekday to weekday)
- **Consider context** (holidays, deployments)
- **Investigate anomalies** immediately

### Action Items from Analytics

| Finding                      | Action                                            |
| ---------------------------- | ------------------------------------------------- |
| High MTTA                    | Review escalation policies, notification channels |
| High MTTR                    | Improve runbooks, add automation                  |
| Frequent breaches on service | Review service reliability                        |
| Uneven team workload         | Adjust on-call rotations                          |
| Night/weekend spikes         | Consider follow-the-sun coverage                  |

### Reporting to Stakeholders

- **Lead with business impact** (not raw numbers)
- **Show trends** (improvement or decline)
- **Include action items** (what you're doing about it)
- **Keep it brief** (executive summary first)

---

## Troubleshooting

### Missing Data

1. Check time range filter
2. Verify service/team filters
3. Confirm incidents exist in the period
4. Check user permissions

### Incorrect Metrics

1. Verify incident timestamps are correct
2. Check for manually backdated incidents
3. Review suppressed/snoozed incident handling
4. Confirm timezone settings

### Slow Dashboard

1. Reduce time range
2. Add more specific filters
3. Limit number of widgets
4. Use cached data option

---

## Related Topics

- [Incidents](./incidents) — Incident lifecycle and management
- [Services](./services) — Service configuration
- [Teams](./teams) — Team management
- [SLA Metrics](#sla-metrics) — SLA compliance, per-urgency tracking and breach analysis
- [Postmortems](./postmortems) — Post-incident analysis
