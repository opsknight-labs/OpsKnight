# OpsKnight Load & Scalability Certification Report

Generated: `2026-09-28T12:20:49.770Z`

## 1. Executive Capacity & Sizing Envelope

| Deployment Topology | Sustainable Alert Ingestion | Burst Alert Ingestion | Notification Dispatch | Escalation Processing | Concurrent Users | SSE Realtime Streams | Status Page Fanout | Primary Bottleneck at Saturation | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| `compose_integrated_bundled_db` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `compose_split_bundled_db` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `compose_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `swarm_single_node_split` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `swarm_ha_split` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Critical notification queue starvation | **FAILED** |
| `kind_helm_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Worker pod resource / pool limits reached at L0 | **FAILED** |
| `kind_kustomize_split_pgbouncer` | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | No certified sustainable capacity | Worker pod resource / pool limits reached at L0 | **FAILED** |

## 2. Benchmark Measured Telemetry Summary

| Phase | Topology | Scenarios | Peak RPS | p95 (ms) | p99 (ms) | Peak PG Conns | Max Queue Age (ms) | Invariants | Status |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Phase 1 | `compose_integrated_bundled_db` | 6 | 13.5 | 35920.2 | 36569.7 | 11 | 161262 | FAIL | **FAILED** |
| Phase 1 | `compose_split_bundled_db` | 7 | 1.7 | 34349.1 | 35438.3 | 9 | 22823 | FAIL | **FAILED** |
| Phase 1 | `compose_split_pgbouncer` | 8 | 14.1 | 40276.4 | 40431.1 | 9 | 199660 | FAIL | **FAILED** |
| Phase 3 | `swarm_single_node_split` | 7 | 14.0 | 36644.9 | 36806.2 | 14 | 179045 | FAIL | **FAILED** |
| Phase 3 | `swarm_ha_split` | 8 | 56.7 | 4001.9 | 4002.1 | 9 | 90881 | FAIL | **FAILED** |
| Phase 4 | `kind_helm_split_pgbouncer` | 8 | 2.8 | 41634.6 | 41804.5 | 9 | 289 | PASS | **FAILED** |
| Phase 4 | `kind_kustomize_split_pgbouncer` | 8 | 2.8 | 38687.3 | 39010.6 | 13 | 627 | PASS | **FAILED** |

## 3. Standardized Resource Profiles

- **Host Specifications**: 10-core CPU, 16 GB RAM, Darwin arm64 / Linux x86_64, Docker Engine 28.x, Kind v0.31.0.
- **Docker Compose**:
  - Integrated: 1 container (web+worker), max DB pool = 40, PostgreSQL max_connections = 100.
  - Split: web (pool=10), critical-worker (pool=15), general-worker (pool=15), bulk-worker (pool=10), status-projector (pool=5).
  - PgBouncer: Transaction mode pooling, max 200 client connections -> 30 server connections.
- **Docker Swarm HA**: 2x Web, 2x Critical Worker, 2x General Worker, 2x Bulk Worker, 2x Status Projector, 2x PgBouncer.
- **Kind Kubernetes (4-Node)**: 1 Control Plane + 3 Worker Nodes, PodDisruptionBudgets (`minAvailable: 1`), isolated worker CPU/RAM quotas.

## 4. Correctness Invariant Certification

| Topology | Zero Duplicate Open Incidents | Zero Lost Accepted Alerts | Zero False Escalations | Zero Corrupted States | Zero Critical Starvation |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `compose_integrated_bundled_db` | PASS (0) | PASS (387) | PASS (0) | PASS (0) | FAIL |
| `compose_split_bundled_db` | PASS (0) | PASS (76) | PASS (0) | PASS (0) | FAIL |
| `compose_split_pgbouncer` | PASS (0) | PASS (196) | PASS (0) | PASS (0) | FAIL |
| `swarm_single_node_split` | PASS (0) | PASS (297) | PASS (0) | PASS (0) | FAIL |
| `swarm_ha_split` | PASS (0) | PASS (758) | PASS (0) | PASS (0) | FAIL |
| `kind_helm_split_pgbouncer` | PASS (0) | PASS (30) | PASS (0) | PASS (0) | PASS (0ms) |
| `kind_kustomize_split_pgbouncer` | PASS (0) | PASS (19) | PASS (0) | PASS (0) | PASS (2554ms) |
