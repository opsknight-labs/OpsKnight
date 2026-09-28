# OpsKnight 2-Hour Soak Test Status Report

- **Elapsed Time**: 7170s / 7200s (99%)
- **Last Sample Time**: 2026-09-25T15:17:26Z
- **Sampling Interval**: 60s

## Docker Compose Split Stack (Local Port 33000)
| Metric | Value |
| --- | --- |
| Total Probes | 119 |
| Successful Probes | 119 |
| Availability | 100.00% |
| Average Latency | 71 ms |
| Peak Latency | 983 ms |
| Running Roles | 8 / 7 (web, scheduler, general, critical, bulk, projector, pgbouncer) |
| Active Database Connections | 40 |

## Kind Kubernetes HA Stack (Local Port 30080)
| Metric | Value |
| --- | --- |
| Total Probes | 119 |
| Successful Probes | 119 |
| Availability | 100.00% |
| Average Latency | 43 ms |
| Peak Latency | 136 ms |
| Running Pods | 25 |
| Unexpected Restarts During Soak | 0 |
