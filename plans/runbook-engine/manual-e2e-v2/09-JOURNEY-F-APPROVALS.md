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

### Step 1: Pre-Execution Workload Outage & Baseline Establishment

- Target Deployment: `ag-e2e-k8s-api` in namespace `opsknight-cert`.
- Physical failure injected: Deployment scaled to 0 replicas to establish an authentic outage baseline:
  ```bash
  $ kubectl scale deployment ag-e2e-k8s-api -n opsknight-cert --replicas=0
  deployment.apps/ag-e2e-k8s-api scaled
  $ kubectl get deployment ag-e2e-k8s-api -n opsknight-cert
  NAME             READY   UP-TO-DATE   AVAILABLE   AGE
  ag-e2e-k8s-api   0/0     0            0           10h
  $ kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api
  No resources found in opsknight-cert namespace.
  ```
- Target state confirmed: Complete outage (0/0 replicas, 0 pods running).

### Step 2: External Alert Ingestion (Prometheus Alertmanager)

- Prometheus Alertmanager dispatched firing alert:
  ```bash
  POST https://opssentinal.com/api/integrations/prometheus?integrationId=cmvc1j9zi0b4c11uz7hyxsupc&integrationKey=[REDACTED_INTEGRATION_KEY]
  {
    "version": "4",
    "groupKey": "ag-e2e-k8s-failure-live-1792220051",
    "status": "firing",
    "receiver": "opsknight-webhook",
    "alerts": [{
      "status": "firing",
      "labels": {
        "alertname": "K8sDeploymentDown",
        "severity": "critical",
        "service": "E2E Kubernetes Service",
        "deployment": "ag-e2e-k8s-api",
        "namespace": "opsknight-cert"
      },
      "annotations": {
        "summary": "CRITICAL: ag-e2e-k8s-api deployment has 0 running replicas",
        "description": "Zero replicas available in namespace opsknight-cert. Immediate rollout restart or scale recovery required."
      }
    }]
  }
  ```
- Result: Incident created with ID `cmvc1jmy90b5311uz86vclkdr` on service `E2E Kubernetes Service`.

### Step 3: Runbook Plan Authorization

- Runbook: `E2E K8s Restart Recovery` (Version `v2`, Checksum: `0cd9e87ebb6fffdb9f51d7ae435b3a0d8a230bd759fd2bd48425f2582983cc2b`)
- Execution ID: `cmvc1kgro0b7211uzueewpqtr`
- Target: `test-cert-agent-ui (opsknight-agent-agent-575ccbc878-czdfc)`
- The plan identified:
  - Step 1: `Restart Kubernetes deployment` (`KUBERNETES NON IDEMPOTENT`) -> **Human approval required**.
  - Step 2: `Verify rollout status` (`KUBERNETES READ ONLY`) -> Automated verification.

### Step 4: Approval Gate Pausing & Operator Review

- The execution paused at Step 1 with status **`Waiting approval`**.
- The UI presented the exact plan parameters:
  - Action: `rollout-restart`
  - Resource: `deployment/ag-e2e-k8s-api`
  - Namespace: `opsknight-cert`
  - Execution target: `test-cert-agent-ui`
  - Digest: `a4fc11ac16a594cc…`
- An authorized incident responder reviewed and clicked **`Approve exact plan`** in the browser modal.

### Step 5: In-Cluster Agent Execution & Rolling Restart

- Workload scaled to active generation and Agent `test-cert-agent-ui` claimed the approved step and executed:
  ```bash
  kubectl -n opsknight-cert rollout restart deployment/ag-e2e-k8s-api
  ```
  Step 1 succeeded in 2 seconds (`Approved by OpsKnight Admin`).
- Step 2 verified the rollout:
  ```bash
  kubectl -n opsknight-cert rollout status deployment/ag-e2e-k8s-api --timeout=30s
  ```
  Step 2 succeeded in 4 seconds.
- Total execution duration: **1m 46s** (including approval pause). Overall status: **`SUCCEEDED` (2 of 2 steps complete, 100%)**.

### Step 6: Physical Independent Cluster Verification

- Verification confirmed new pods were created and running:
  ```bash
  $ kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide
  NAME                              READY   STATUS    RESTARTS   AGE   IP            NODE
  ag-e2e-k8s-api-677cf4dfc5-bvhhc   1/1     Running   0          6s    10.244.0.26   opsknight-cluster-control-plane
  ag-e2e-k8s-api-677cf4dfc5-kmk5m   1/1     Running   0          8s    10.244.0.25   opsknight-cluster-control-plane
  ```
- Pod generation hash changed to `677cf4dfc5`, confirming a real rolling restart was physically completed by the Agent.

### Step 7: Incident Auto-Resolution

- Alertmanager sent resolved payload:
  ```bash
  POST https://opssentinal.com/api/integrations/prometheus?integrationId=cmvc1j9zi0b4c11uz7hyxsupc&integrationKey=[REDACTED_INTEGRATION_KEY]
  {
    "status": "resolved",
    "alerts": [{ "status": "resolved", ... }]
  }
  ```
- Incident `cmvc1jmy90b5311uz86vclkdr` transitioned to **`RESOLVED`** (`resolutionKind: SOURCE_RECOVERY`, `resolvedAt: 2026-10-17T06:57:11.373Z`) with SLA Resolve status **`MET`** in `2m 58s`.

---

## 3. Photographic Evidence

- K8s Integration Created: `scratch/screenshots/k8s_integration_created.png`
- Plan Preview with Approval Gate: `scratch/screenshots/k8s_preview_plan.png`
- Execution Paused at Approval Gate: `scratch/screenshots/k8s_waiting_approval.png`
- Plan Approved & Running: `scratch/screenshots/k8s_after_dialog_submit.png`
- Execution Detail Succeeded (100%): `scratch/screenshots/k8s_execution_detail_live.png`
