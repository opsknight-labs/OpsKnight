---
order: 3
title: Metrics & Alerting
description: Server daemons, metrics pipelines, and Alertmanager-compatible webhooks.
---

# Metrics & Alerting Integrations

Send metric-based alerts and daemon status checks into OpsKnight using native webhooks, SNMP/agent alerts, and Alertmanager-compatible payloads.

## Available Integrations

<!-- integrations-list:start -->

- [Prometheus / Alertmanager](./prometheus) — Receive Prometheus Alertmanager grouped alerts and resolve notifications in OpsKnight.
- [Zabbix](./zabbix) — Connect Zabbix triggers, problems, and recoveries with dynamic severity mapping (`Disaster`, `High`, `Average`, `Warning`, `Information`).
- [Nagios Core & XI](./nagios) — Process Nagios host and service state transitions (`CRITICAL`, `WARNING`, `DOWN`, `RECOVERY`) with macro variable support.
- [Icinga 2](./icinga) — Ingest check results and notifications from Icinga 2 monitoring daemons.

<!-- integrations-list:end -->

---

## Capabilities Comparison

| Monitoring system    | Transport    | States supported                                     | Correlation key                                     |
| :------------------- | :----------- | :--------------------------------------------------- | :-------------------------------------------------- |
| **Prometheus**       | JSON webhook | `firing`, `resolved`                                 | Raw fingerprint; otherwise SHA-256 of sorted labels |
| **Zabbix**           | JSON webhook | `PROBLEM`, `RESOLVED`, `OK`, acknowledgment variants | Event ID, then trigger/host fallback                |
| **Nagios Core / XI** | JSON POST    | Problems, recovery, ack, downtime, flapping, custom  | `nagios-{host}` or `nagios-{host}-{service}`        |
| **Icinga 2**         | JSON webhook | Problems, recovery, ack, downtime, flapping, custom  | `icinga-{host}` or `icinga-{host}-{service}`        |
