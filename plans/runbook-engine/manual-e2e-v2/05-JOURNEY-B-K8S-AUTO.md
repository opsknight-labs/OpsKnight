# Phase 5 — Journey B: Kubernetes Idempotent Scale & Pod Recovery

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Control Plane:** OpsKnight SaaS (`https://opssentinal.com`)  
**Target Environment:** Kind Cluster `opsknight-cluster` (Namespace: `opsknight-cert`)  
**Assigned Agent:** `test-cert-agent-ui` (`opsknight-agent-agent-575ccbc878-czdfc`)

---

## 1. Journey Architecture & Objective

Journey B verifies the Kubernetes executor for idempotent write operations (`scale` with target replicas) and read-only verification (`rollout-status` and `get pods`).

Because `scale` to an explicit replica count is idempotent, it can run as an automated recovery action within the safety budget without requiring human approval gates.

---

## 2. Infrastructure & Execution Verification

### 2.1 Target Deployment & Service

- Deployment: `ag-e2e-k8s-api`
- Namespace: `opsknight-cert`
- Replica target: 2 replicas
- In-cluster Service: `ag-e2e-k8s-api-svc` (Port 80)

### 2.2 Execution Receipts

- The Agent `test-cert-agent-ui` running inside the Kind cluster executed the Kubernetes scale and rollout verification:
  1. `KUBERNETES` action `scale`: Target `ag-e2e-k8s-api`, Namespace `opsknight-cert`, Replicas `2`.
  2. `KUBERNETES` action `rollout-status`: Verified deployment `ag-e2e-k8s-api` reached 2 available replicas within timeout.
- Independent cluster verification:
  ```bash
  $ kubectl get deployment ag-e2e-k8s-api -n opsknight-cert
  NAME             READY   UP-TO-DATE   AVAILABLE   AGE
  ag-e2e-k8s-api   2/2     2            2           8h
  ```
- Output and evidence: Clean zero-exit code execution, bounded stdout/stderr recorded in execution history.
