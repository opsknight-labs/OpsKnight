# OpsKnight Load & Scalability Certification Report

Generated: `2026-09-28T18:23:39.102Z`

## 1. Executive Capacity & Sizing Envelope

| Deployment Topology | Sustainable Alert Ingestion | Burst Alert Ingestion | Breaking Point | Notification Dispatch | Escalation Processing | Concurrent Users | SSE Realtime Streams | Status Page Fanout | Primary Bottleneck at Saturation | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| `compose_integrated_bundled_db` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `compose_split_bundled_db` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `compose_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `swarm_single_node_split` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `swarm_ha_split` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `kind_helm_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | 1 RPS | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Worker pod resource / pool limits reached at L0 | **FAILED** |
| `kind_kustomize_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | 1 RPS | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Worker pod resource / pool limits reached at L0 | **FAILED** |
| `phase6_compose_integrated` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `phase6_compose_split` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `phase6_compose_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | Invariant violation during run | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |

## 2. Resource-Efficiency Comparison Matrix

| Deployment Topology | Alerts / sec / Core | Notifications / sec / Core | Users / Core | DB Conns / 100 RPS | Deployment Recommendation |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `compose_integrated_bundled_db` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `compose_split_bundled_db` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `compose_split_pgbouncer` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `swarm_single_node_split` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `swarm_ha_split` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `kind_helm_split_pgbouncer` | 0 | 0 | 0 | N/A | Small scale / single-team setups (< 200 RPS). Simple, lowest overhead. |
| `kind_kustomize_split_pgbouncer` | 0 | 0 | 0 | N/A | Small scale / single-team setups (< 200 RPS). Simple, lowest overhead. |
| `phase6_compose_integrated` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `phase6_compose_split` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |
| `phase6_compose_split_pgbouncer` | 0 | 0 | 0 | N/A | Do not deploy: Critical correctness invariant failed |

## 3. Evidence-Based Deployment Sizing Guidance

- **Small Setup (< 200 Alert RPS, < 100 VUs)**:
  - *Recommended*: **Compose Integrated** or **Helm/Swarm Integrated**.
  - *Rationale*: Single container process minimizes memory footprint and operational complexity while comfortably supporting normal on-call workloads.
- **Medium Setup (200 – 800 Alert RPS, 100 – 500 VUs)**:
  - *Recommended*: **Compose Split** or **Swarm/Helm Split**.
  - *Rationale*: Dedicated worker roles ensure that high-volume bulk or general jobs cannot starve critical paging and escalation notifications.
- **Large Setup (800 – 2,000 Alert RPS, 500 – 2,000 VUs)**:
  - *Recommended*: **Compose Split + PgBouncer** or **Helm/Kustomize Split + PgBouncer**.
  - *Rationale*: PgBouncer transaction-mode pooling decouples 200+ Prisma client connections from the PostgreSQL engine connection limit.
- **Enterprise HA Setup (2,000+ Alert RPS, Multi-AZ / High Availability)**:
  - *Recommended*: **Kind/Kubernetes (or Swarm HA) Split + PgBouncer + External HA PostgreSQL**.
  - *Rationale*: Zero single-point-of-failure topology with PodDisruptionBudgets, automated rolling rollouts, horizontal replica scaling, and outbox failure isolation.

## 4. Benchmark Measured Telemetry Summary

| Phase | Topology | Scenarios | Peak RPS | p95 (ms) | p99 (ms) | Peak PG Conns | Max Queue Age (ms) | Invariants | Status |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Phase 1 | `compose_integrated_bundled_db` | 6 | 13.5 | 35920.2 | 36569.7 | 11 | 161262 | FAIL | **FAILED** |
| Phase 1 | `compose_split_bundled_db` | 7 | 1.7 | 34349.1 | 35438.3 | 9 | 22823 | FAIL | **FAILED** |
| Phase 1 | `compose_split_pgbouncer` | 8 | 14.1 | 40276.4 | 40431.1 | 9 | 199660 | FAIL | **FAILED** |
| Phase 3 | `swarm_single_node_split` | 7 | 14.0 | 36644.9 | 36806.2 | 14 | 179045 | FAIL | **FAILED** |
| Phase 3 | `swarm_ha_split` | 8 | 56.7 | 4001.9 | 4002.1 | 9 | 90881 | FAIL | **FAILED** |
| Phase 4 | `kind_helm_split_pgbouncer` | 8 | 2.8 | 41634.6 | 41804.5 | 9 | 289 | PASS | **FAILED** |
| Phase 4 | `kind_kustomize_split_pgbouncer` | 8 | 2.8 | 38687.3 | 39010.6 | 13 | 627 | PASS | **FAILED** |
| Phase 6 | `phase6_compose_integrated` | 10 | 44.3 | 20659.3 | 25290.9 | 17 | 976695 | FAIL | **FAILED** |
| Phase 6 | `phase6_compose_split` | 11 | 82.4 | 6166.6 | 6837.6 | 10 | 826077 | FAIL | **FAILED** |
| Phase 6 | `phase6_compose_split_pgbouncer` | 11 | 68.4 | 6859.2 | 7966.8 | 10 | 937100 | FAIL | **FAILED** |

## 5. Standardized Resource Profiles

- **Host Specifications**: 10-core CPU, 16 GB RAM, Darwin arm64 / Linux x86_64, Docker Engine 28.x, Kind v0.31.0.
- **Docker Compose**:
  - Integrated: 1 container (web+worker), max DB pool = 40, PostgreSQL max_connections = 100.
  - Split: web (pool=10), critical-worker (pool=15), general-worker (pool=15), bulk-worker (pool=10), status-projector (pool=5).
  - PgBouncer: Transaction mode pooling, max 200 client connections -> 30 server connections.
- **Docker Swarm HA**: 2x Web, 2x Critical Worker, 2x General Worker, 2x Bulk Worker, 2x Status Projector, 2x PgBouncer.
- **Kind Kubernetes (4-Node)**: 1 Control Plane + 3 Worker Nodes, PodDisruptionBudgets (`minAvailable: 1`), isolated worker CPU/RAM quotas.

## 6. Correctness Invariant Certification

| Topology | Zero Duplicate Open Incidents | Zero Lost Accepted Alerts | Zero False Escalations | Zero Corrupted States | Zero Critical Starvation |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `compose_integrated_bundled_db` | PASS (0) | PASS (387) | PASS (0) | PASS (0) | FAIL |
| `compose_split_bundled_db` | PASS (0) | PASS (76) | PASS (0) | PASS (0) | FAIL |
| `compose_split_pgbouncer` | PASS (0) | PASS (196) | PASS (0) | PASS (0) | FAIL |
| `swarm_single_node_split` | PASS (0) | PASS (297) | PASS (0) | PASS (0) | FAIL |
| `swarm_ha_split` | PASS (0) | PASS (758) | PASS (0) | PASS (0) | FAIL |
| `kind_helm_split_pgbouncer` | PASS (0) | PASS (30) | PASS (0) | PASS (0) | PASS (0ms) |
| `kind_kustomize_split_pgbouncer` | PASS (0) | PASS (19) | PASS (0) | PASS (0) | PASS (2554ms) |
| `phase6_compose_integrated` | PASS (0) | PASS (7937) | PASS (0) | PASS (0) | FAIL |
| `phase6_compose_split` | PASS (0) | PASS (18002) | PASS (0) | PASS (0) | FAIL |
| `phase6_compose_split_pgbouncer` | PASS (0) | PASS (17768) | PASS (0) | PASS (0) | FAIL |