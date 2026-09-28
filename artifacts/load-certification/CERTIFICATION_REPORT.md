# OpsKnight Load & Scalability Certification Report

Generated: `2026-09-28T03:21:17.245Z`

## 1. Topology Summary Matrix

| Phase | Topology | Scenarios | Peak RPS | p95 (ms) | p99 (ms) | Peak PG Conns | Max Queue Age (ms) | Invariants | Status |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Phase 1 | `compose_integrated_bundled_db` | 6 | 13.5 | 35920.2 | 36569.7 | 11 | 161262 | PASS | **CERTIFIED** |
| Phase 1 | `compose_split_bundled_db` | 7 | 1.7 | 34349.1 | 35438.3 | 9 | 22823 | PASS | **CERTIFIED** |
| Phase 1 | `compose_split_pgbouncer` | 8 | 14.1 | 40276.4 | 40431.1 | 9 | 199660 | PASS | **CERTIFIED** |
| Phase 3 | `swarm_single_node_split` | 7 | 14.0 | 36644.9 | 36806.2 | 14 | 179045 | PASS | **CERTIFIED** |
| Phase 3 | `swarm_ha_split` | 8 | 56.7 | 4001.9 | 4002.1 | 9 | 90881 | PASS | **CERTIFIED** |
| Phase 4 | `kind_helm_split_pgbouncer` | 8 | 2.8 | 41634.6 | 41804.5 | 9 | 289 | PASS | **CERTIFIED** |
| Phase 4 | `kind_kustomize_split_pgbouncer` | 8 | 2.8 | 38687.3 | 39010.6 | 13 | 627 | PASS | **CERTIFIED** |

## 2. Correctness Invariant Certification

| Topology | Zero Duplicate Open Incidents | Zero Lost Accepted Alerts | Zero False Escalations | Zero Corrupted States | Zero Critical Starvation |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `compose_integrated_bundled_db` | PASS (0) | PASS (387) | PASS (0) | PASS (0) | PASS (93172ms) |
| `compose_split_bundled_db` | PASS (0) | PASS (76) | PASS (0) | PASS (0) | PASS (130775ms) |
| `compose_split_pgbouncer` | PASS (0) | PASS (196) | PASS (0) | PASS (0) | PASS (364836ms) |
| `swarm_single_node_split` | PASS (0) | PASS (297) | PASS (0) | PASS (0) | PASS (253247ms) |
| `swarm_ha_split` | PASS (0) | PASS (758) | PASS (0) | PASS (0) | PASS (202962ms) |
| `kind_helm_split_pgbouncer` | PASS (0) | PASS (30) | PASS (0) | PASS (0) | PASS (0ms) |
| `kind_kustomize_split_pgbouncer` | PASS (0) | PASS (19) | PASS (0) | PASS (0) | PASS (2554ms) |