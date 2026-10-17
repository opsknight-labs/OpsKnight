# Phase 4 — Journey A: Docker Unattended Auto-Recovery Certification

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Control Plane:** OpsKnight SaaS (`https://opssentinal.com`)  
**Target Environment:** Local Docker Engine (`ag-e2e-docker-api` on port 8095)  
**Assigned Agent:** `docker-host-agent` (Container `9c30a68ed4c9`)

---

## 1. Journey Architecture & Objective

Journey A validates the complete, closed-loop unattended remediation lifecycle for idempotent Docker container failures:

$$\text{Real Container Crash} \longrightarrow \text{Alertmanager Webhook} \longrightarrow \text{OpsKnight Incident} \longrightarrow \text{Runbook Execution} \longrightarrow \text{Physical Recovery} \longrightarrow \text{Independent Health Verification} \longrightarrow \text{Incident Auto-Resolution}$$

---

## 2. Step-by-Step Execution Receipts

### Step 1: Pre-Execution Baseline

- Workload: Container `ag-e2e-docker-api` running on host.
- Initial check:
  ```bash
  $ curl -s http://localhost:8095/health
  {"status":"ok","counter":13985,"uptime":28790.87}
  $ docker inspect --format='{{.State.Status}}' ag-e2e-docker-api
  running
  ```

### Step 2: Physical Failure Injection

- Command executed:
  ```bash
  $ docker stop ag-e2e-docker-api
  ag-e2e-docker-api
  $ docker inspect --format='{{.State.Status}}' ag-e2e-docker-api
  exited
  $ curl -s --connect-timeout 2 http://localhost:8095/health
  curl: (7) Failed to connect to localhost port 8095: Connection refused
  ```
- Target state confirmed: Down (`exited`).

### Step 3: Inbound Monitoring Alert (Prometheus Alertmanager)

- Alertmanager webhook dispatched to OpsKnight SaaS integration:
  ```bash
  POST https://opssentinal.com/api/integrations/prometheus?integrationId=cmvbxgekn02dg11uzzmjs5ev7&integrationKey=882769478ae415002dc2feeb27b5f172
  {
    "version": "4",
    "groupKey": "ag-e2e-docker-api-failure-2",
    "status": "firing",
    "receiver": "opsknight-webhook",
    "alerts": [{
      "status": "firing",
      "labels": {
        "alertname": "ContainerDown",
        "severity": "critical",
        "service": "E2E Docker Service",
        "container": "ag-e2e-docker-api"
      },
      "annotations": {
        "summary": "CRITICAL: ag-e2e-docker-api container down",
        "description": "Container ag-e2e-docker-api stopped responding on port 8095."
      }
    }]
  }
  ```
- Result: Incident created with ID `cmvbxz59703kr11uze0anc00x` on service `E2E Docker Service`.

### Step 4: Runbook Plan Authorization & Execution

- Runbook: `Automated Docker Container Recovery` (Version: `v2`, Checksum: `79a23a0222e7`)
- Execution ID: `cmvbxzhs70`
- Execution Steps:
  1. **Start Container** (`DOCKER IDEMPOTENT WRITE`): Started container `ag-e2e-docker-api`. Status: `SUCCEEDED` (Duration 3s).
  2. **Verify Health** (`DOCKER READ ONLY`): Queried Docker health status. Agent waited for container to transition from `starting` to `healthy`. Status: `SUCCEEDED` (Duration 6s).
- Total execution duration: **9 seconds**. Overall status: **`SUCCEEDED` (2 of 2 steps complete, 100%)**.

### Step 5: Independent Target Verification

- Verification confirmed physical recovery of the container on the host:
  ```bash
  $ docker inspect --format='{{.State.Status}} {{.State.Health.Status}}' ag-e2e-docker-api
  running healthy
  $ curl -s http://localhost:8095/health
  {"status":"ok","counter":7,"uptime":16.23}
  ```

### Step 6: Incident Auto-Resolution

- Monitoring monitor confirmed health recovery, and Alertmanager sent resolved payload:
  ```bash
  POST https://opssentinal.com/api/integrations/prometheus?integrationId=cmvbxgekn02dg11uzzmjs5ev7&integrationKey=882769478ae415002dc2feeb27b5f172
  {
    "status": "resolved",
    "alerts": [{ "status": "resolved", ... }]
  }
  ```
- Result: Incident `cmvbxz59703kr11uze0anc00x` transitioned to `RESOLVED` (`resolutionKind: SOURCE_RECOVERY`) with SLA Resolve status `MET` in `< 1 min`.

---

## 3. Photographic & Diagnostic Evidence

- Incident Page (Firing): `screenshots/journey_a_incident_page.png`
- Plan Authorization in UI: `screenshots/plan_confirmed.png`
- Live Execution in Progress: `screenshots/journey_a_executing.png`
- Execution Succeeded (100%): `screenshots/journey_a_final_succeeded.png`
- Incident Resolved (SLA MET): `screenshots/journey_a_incident_resolved.png`
