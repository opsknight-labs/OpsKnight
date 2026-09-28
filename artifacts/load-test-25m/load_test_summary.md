# OpsKnight 25-Minute Multi-Stage Load & Saturation Report

- **Elapsed Time**: 1470s / 1500s (98%)
- **Current Active Stage**: `6. Cool-down & Audit`
- **Report Generated**: 2026-09-25T15:29:23.665Z

---

## 1. Executive Summary

| Deployment Topology | Total Requests Tested | Successful (2xx) | Errors / Drop | Availability | Peak Web Memory | Max DB Conns / Restarts |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Docker Compose Split Stack** | 145,708 | 145,708 | 0 | **100.00%** | 529 MiB | 41 connections |
| **Kind HA Kubernetes Cluster** | 145,708 | 145,708 | 0 | **100.00%** | 237 MiB (Limit: 1Gi) | 7 restarts |

---

## 2. Saturation & OOM Limit Findings
- **Kubernetes Pod OOM Ceiling (1,024 MiB)**: Web pod peak memory reached **237 MiB** (23% of limit).
- **Docker Compose Memory Consumption**: Web container peak memory reached **529 MiB**.
- **PgBouncer Multiplexing**: Handled concurrent connections with maximum pool stability.
- **Pod Restarts / Flapping**: **7** restarts observed.
