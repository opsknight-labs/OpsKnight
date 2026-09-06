---
order: 3
title: Metrics & Alerting
description: Server daemons, metrics pipelines, and Alertmanager-compatible webhooks.
---

# Metrics & Alerting Integrations

Send metric-based alerts and daemon status checks into OpsKnight using native webhooks, SNMP/agent alerts, and Alertmanager-compatible payloads.

## Available Integrations

<!-- integrations-list:start -->

- [Prometheus / Alertmanager](./metrics-alerting/prometheus) — Receive Prometheus Alertmanager grouped alerts and resolve notifications in OpsKnight.
- [Zabbix](./metrics-alerting/zabbix) — Connect Zabbix triggers, problems, and recoveries with dynamic severity mapping (`Disaster`, `High`, `Average`, `Warning`, `Information`).
- [Nagios Core & XI](./metrics-alerting/nagios) — Process Nagios host and service state transitions (`CRITICAL`, `WARNING`, `DOWN`, `RECOVERY`) with macro variable support.
- [Icinga 2](./metrics-alerting/icinga) — Ingest check results and notifications from Icinga 2 monitoring daemons.
<!-- integrations-list:end -->

---

## Capabilities Comparison

| Monitoring System | Transport | States Supported | Dedup Key Format |
| :--- | :--- | :--- | :--- |
| **Prometheus** | JSON Webhook | `firing`, `resolved` | `alertname + instance` hash |
| **Zabbix** | JSON Webhook | `PROBLEM`, `RESOLVED` | `event_id` / `trigger_id` |
| **Nagios Core / XI**| HTTP POST | `CRITICAL`, `WARNING`, `DOWN`, `UP`, `OK` | `host + service` hash |
| **Icinga 2** | JSON Webhook | `CRITICAL`, `WARNING`, `DOWN`, `OK` | `icinga2-check-{host}-{service}` |
