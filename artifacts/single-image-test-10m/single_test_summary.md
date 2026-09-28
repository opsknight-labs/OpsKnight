# OpsKnight 10-Minute Single-Image Capacity & Saturation Report

- **Elapsed Time**: 560s / 600s (93%)
- **Current Active Stage**: `4. Extreme Breaking Point Shock`
- **Topology**: Integrated Single-Image (Web + All Background Workers in 1 Container, Direct DB Connection, NO PgBouncer)

---

## 1. Executive Summary

| Deployment Topology | Total Requests | Successful (2xx) | Errors / Dropped | Availability | Peak Memory | Max DB Conns / Restarts |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Single-Image Compose** | 21,504 | 21,504 | 0 | **100.00%** | 390 MiB | 13 connections |
| **Single-Image Kind K8s** | 21,504 | 21,504 | 0 | **100.00%** | 245 MiB (Limit: 1Gi) | 0 restarts |
