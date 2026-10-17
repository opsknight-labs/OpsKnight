# Phase 9 — Journey F: Kubernetes Non-Idempotent Approval-Required Recovery

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Control Plane:** OpsKnight SaaS (`https://opssentinal.com`)  
**Target Environment:** Kind Cluster `opsknight-cluster` (Namespace: `opsknight-cert`)  
**Assigned Agent:** `test-cert-agent-ui` (`opsknight-agent-agent-575ccbc878-czdfc`)

---

## 1. Journey Architecture & Risk Model

Enterprise safety rule: **Non-idempotent actions require explicit human approval, and the default automatic non-idempotent budget is zero.**

A Kubernetes rollout restart replaces running pods with new ones. Unlike idempotent scaling, repeated or unauthorized rollout restarts can cause cascading outages. Therefore, the engine strictly requires a human approval gate before the mutation is dispatched.

---

## 2. Step-by-Step Execution Receipts

### Step 1: Pre-Execution Pod Baseline

- Namespace: `opsknight-cert`, Deployment: `ag-e2e-k8s-api`
- Pod state recorded prior to restart:
  ```bash
  $ kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,AGE:.metadata.creationTimestamp
  NAME                              STATUS    AGE
  ag-e2e-k8s-api-84656fc84f-qvvg8   Running   2026-10-16T21:22:00Z
  ag-e2e-k8s-api-84656fc84f-xj9tx   Running   2026-10-16T21:21:59Z
  ```

### Step 2: External Alert Ingestion

- Prometheus Alertmanager dispatched firing alert:
  ```bash
  POST https://opssentinal.com/api/integrations/prometheus?integrationId=cmvbxi8sk02h211uzblpz7a70&integrationKey=f88d7b93b3a53bd82de873b19f9857d5
  {
    "status": "firing",
    "alerts": [{
      "status": "firing",
      "labels": {
        "alertname": "K8sDeploymentDown",
        "severity": "critical",
        "service": "E2E Kubernetes Service",
        "deployment": "ag-e2e-k8s-api"
      },
      "annotations": {
        "summary": "CRITICAL: Kubernetes ag-e2e-k8s-api deployment outage"
      }
    }]
  }
  ```
- Result: Incident created with ID `cmvby1lnd03rg11uz9zxpsxsp` on service `E2E Kubernetes Service`.

### Step 3: Runbook Plan Authorization

- Runbook: `E2E K8s Restart Recovery` (Version `v2`, Checksum: `0cd9e87ebb6f`)
- Execution ID: `cmvby2eam03tg11uzx02ukln9`
- The plan identified:
  - Step 1: `Restart Kubernetes deployment` (KUBERNETES NON IDEMPOTENT) -> **Human approval required**.
  - Step 2: `Verify rollout status` (KUBERNETES READ ONLY) -> Automated verification.

### Step 4: Approval Gate Pausing & Operator Review

- The execution paused at Step 1 with status **`Waiting approval`**.
- The UI presented the exact plan parameters:
  - Action: `rollout-restart`
  - Resource: `deployment/ag-e2e-k8s-api`
  - Namespace: `opsknight-cert`
  - Plan digest: `a4fc11ac16a594cc2a222bb03c95e655adf55cadc6f6b730f5accfef0d0ea14f`
- An authorized incident responder reviewed and clicked **`Approve exact plan`** in the browser.

### Step 5: In-Cluster Agent Execution & Rolling Restart

- Agent `test-cert-agent-ui` claimed the approved step and executed:
  ```bash
  kubectl -n opsknight-cert rollout restart deployment/ag-e2e-k8s-api
  ```
  Step 1 succeeded in 4 seconds.
- Step 2 verified the rollout:
  ```bash
  kubectl -n opsknight-cert rollout status deployment/ag-e2e-k8s-api --timeout=30s
  ```
  Step 2 succeeded immediately.
- Total execution status: **`SUCCEEDED` (2 of 2 steps complete, 100%)**.

### Step 6: Physical Independent Cluster Verification

- Verification confirmed new pods were created and running:
  ```bash
  $ kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,AGE:.metadata.creationTimestamp
  NAME                              STATUS    AGE
  ag-e2e-k8s-api-75bcd7bc5f-spwln   Running   2026-10-17T05:17:41Z
  ag-e2e-k8s-api-75bcd7bc5f-zs5q5   Running   2026-10-17T05:17:39Z
  ```
- Pod generation hash changed from `84656fc84f` to `75bcd7bc5f`, confirming a real rolling restart was physically completed by the Agent.

### Step 7: Incident Auto-Resolution

- Alertmanager sent resolved payload to the integration endpoint.
- Incident `cmvby1lnd03rg11uz9zxpsxsp` transitioned to **`RESOLVED`** with SLA Resolve status **`MET`** in 2 minutes.

---

## 3. Photographic Evidence

- Incident Page with Suggested Rule: `screenshots/journey_f_k8s_incident_runbooks.png`
- Plan Preview with Approval Gate: `screenshots/journey_f_k8s_preview_rendered.png`
- Execution Paused at Approval Gate: `screenshots/journey_f_waiting_approval.png`
- Plan Approved & Running: `screenshots/journey_f_submitted_approved.png`
- Incident Resolved (SLA MET): `screenshots/journey_f_incident_resolved.png`
