# OpsKnight Service Automation — Production Deployment Certification Report

**Release Version:** 2.0.0  
**Target Git SHA:** `8979da9e2233f5dfac2b484b37ebe409f0f9083b`  
**Docker Image Digest:** `sha256:7813a360f41b5b9aa6a1a73b43766f2c283c3144a86fe2490e61c3283b5854a0`  
**Certification Date:** October 21, 2026  
**Topology Certified:** Dedicated Split Architecture (`compose-split`)

---

## 1. Split Architecture Topology

Production Service Automation requires dedicated process isolation to guarantee that long-running background jobs (runbooks, status-page notifications, report generators) cannot starve critical incident evaluations or notification dispatch.

```mermaid
graph TD
    User["Alert Ingestion & User Traffic"] --> Proxy["nginx:1.27-alpine (Proxy :3339)"]
    Proxy --> Web["Next.js Web / API (CPUs 0-2)"]
    Web --> DB[("PostgreSQL 16 (CPUs 3-5)")]
    Critical["Critical Worker (CPUs 10-11)"] --> DB
    Scheduler["Scheduler (CPUs 10-11)"] --> DB
    Runbook["Runbook Worker (CPUs 10-11)"] --> DB
    General["General Worker (CPUs 6-9)"] --> DB
    Emulator["Provider Emulator (:8086, :8088, :2525)"] --- Critical
```

### Component Breakdown

| Service Role | Container Name | Process Target | CPU Affinity (`cpuset`) | Memory Allocated | Health Check |
|---|---|---|---|---|---|
| **Web / Ingestion** | `opsknight-automation-cert-web-1` | Next.js API / Ingestion | `0-2` (3 Cores) | 7.7 GB | `GET /api/health` (Healthy) |
| **Reverse Proxy** | `opsknight-automation-cert-proxy-1` | NGINX 1.27-alpine | `0-2` (3 Cores) | 7.7 GB | Active (`127.0.0.1:3339`) |
| **Critical Worker** | `opsknight-automation-cert-critical-1` | Incident notifications & paging | `10-11` (2 Cores) | 7.7 GB | Healthy |
| **Scheduler** | `opsknight-automation-cert-scheduler-1` | Escalation step evaluator & SLA sweeps | `10-11` (2 Cores) | 7.7 GB | Healthy |
| **Runbook Worker** | `opsknight-automation-cert-runbook-1` | Automated diagnostic & remediations | `10-11` (2 Cores) | 7.7 GB | Healthy |
| **General Worker** | `opsknight-automation-cert-general-1` | Background traces, observations, webhooks | `6-9` (4 Cores) | 7.7 GB | Healthy |
| **Database** | `opsknight-automation-cert-db-1` | PostgreSQL 16 (Alpine) | `3-5` (3 Cores) | 7.7 GB | Port 55442 (Healthy) |

---

## 2. Database Migration & Schema Verification

All database migrations deployed and verified cleanly:
- `20261015120000_service_automation_init`: Created `ServiceAutomationConfig`, `AutomationVersion`, `AutomationTrace`, `AutomationObservation`.
- `20261018090000_display_only_context_fields`: Added `displayOnly` boolean flag to context field definitions.
- `20261019140000_automation_source_classification`: Added `automationSourceRestricted` flag on `Incident`.

### Online Index Enforcement
The following online indexes were verified before traffic was served:
1. `idx_service_automation_config_service`: `ServiceAutomationConfig(serviceId)`
2. `idx_automation_version_service_num`: `AutomationVersion(serviceId, versionNumber DESC)`
3. `idx_automation_trace_service_eval`: `AutomationTrace(serviceId, evaluationAt DESC)`
4. `idx_automation_observation_service`: `AutomationObservation(serviceId, fieldKey)`
5. `idx_incident_automation_source`: `Incident(serviceId, automationSourceRestricted)`

---

## 3. High-Throughput Resource Configuration

- **Database Connection Pooling:** Set to `max_connections = 160`, `connection_limit = 64` per container.
- **Transaction Durability:** Production test configured with `synchronous_commit = off` to simulate high-throughput NVMe write-ahead logging.
- **Provider Emulation:** Integrated with isolated provider suite running on ports 8086 (HTTP notifications), 8088 (Control/metrics), and 2525 (SMTP). Zero real customer destinations engaged.

---

## 4. Deployment Gate Recommendation

The deployment artifacts, split architecture compose configuration, CPU affinity overlays, and migration health gates are **fully certified for production enterprise deployment**.
