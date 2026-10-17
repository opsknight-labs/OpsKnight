# OpsKnight Runbook Engine — Physical Infrastructure Recovery Evidence

This document establishes concrete, independent, physical evidence of infrastructure changes performed during the End-to-End Enterprise Certification. OpsKnight marked executions are correlated directly with raw operating system, Docker daemon, and Kubernetes API statuses.

---

## 1. Journey A: Fully Automatic Unattended Recovery (Docker Target)

### 1.1 Objective & Test Scope

- **Workload Target**: `ag-e2e-docker-api` (Port 8095:8080, custom HTTP JSON server with healthcheck)
- **Remediation Action**: `DOCKER` `start` (`IDEMPOTENT_WRITE`)
- **Verification Action**: `DOCKER` `health` (`READ_ONLY`)
- **Execution Mode**: `AUTOMATIC` (0 approval gates, fully unattended)
- **Incident Under Test**: `#cmvbgip3` (`CRITICAL: ag-e2e-docker-api container outage`)

### 1.2 Failure Injection & Initial State

1. **Container Stoppage Injected**:
   ```bash
   docker stop ag-e2e-docker-api
   ```
2. **Pre-Remediation Verification**:
   - `docker inspect ag-e2e-docker-api --format '{{.State.Status}} {{.State.Running}}'`:
     ```text
     exited false
     ```
   - HTTP Endpoint Probe:
     ```bash
     curl -s http://127.0.0.1:8095/health
     # Failed: curl: (7) Failed to connect to 127.0.0.1 port 8095: Connection refused
     ```

### 1.3 OpsKnight Trigger & Execution

- **Automation Rule**: `Auto Remediation Docker API` (`cmvbggld301silnzi9b329eey`) attached to `E2E Docker Service` (`cmvbffoig07q614marj783x7f`).
- **Policy Certification**: Preflight signed policy check validated and transitioned to `PASSED`.
- **Execution Started**: `cmvbgk6v4021qlnzikqbbye1o` dispatched to `docker-host-agent` (`cmvbcv9lr02hz14mah9j953nm`, container `31eadaeb257e`).
- **Approval Gates**: 0 (Idempotent write ran without human intervention).

### 1.4 Post-Remediation Physical Proof

1. **Container State**:
   ```bash
   docker inspect ag-e2e-docker-api --format 'Status: {{.State.Status}}, Health: {{.State.Health.Status}}, Running: {{.State.Running}}'
   ```
   **Output**:
   ```text
   Status: running, Health: healthy, Running: true
   ```
2. **HTTP Live Health Response**:
   ```bash
   curl -i http://127.0.0.1:8095/health
   ```
   **Output**:
   ```http
   HTTP/1.1 200 OK
   Content-Type: application/json
   Date: Sat, 17 Oct 2026 02:35:48 GMT
   Connection: keep-alive
   Keep-Alive: timeout=5
   Content-Length: 46

   {"status":"healthy","uptime":98.810557458}
   ```
3. **OpsKnight Recorded Execution**:
   - Status: `Succeeded` (100% complete, 2/2 steps).
   - Step 1 Output: `Started container ag-e2e-docker-api`.
   - Step 2 Output: `Container ag-e2e-docker-api is healthy`.

---

## 2. Journey B: Human-Approved Remediation (Kubernetes Target)

### 2.1 Objective & Test Scope

- **Workload Target**: `ag-e2e-k8s-api` Deployment in `opsknight-cert` namespace on Kind cluster (`opsknight-cluster`).
- **Remediation Action**: `KUBERNETES` `rollout-restart` (`NON_IDEMPOTENT`, Approval required).
- **Verification Action**: `KUBERNETES` `rollout-status` (`READ_ONLY`).
- **Execution Mode**: `SUGGESTED` (Triggered on incident, halted for human responder approval).
- **Incident Under Test**: `#cmvbh1wh` (`CRITICAL: Kubernetes ag-e2e-k8s-api deployment outage`).

### 2.2 Pre-Remediation Physical State

1. **ReplicaSet & Pod Baseline**:
   ```bash
   kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide
   ```
   **Output**:
   ```text
   NAME                              READY   STATUS    RESTARTS   AGE   IP            NODE
   ag-e2e-k8s-api-844c84d7b6-lhx4h   1/1     Running   0          49m   10.244.0.12   opsknight-cluster-control-plane
   ag-e2e-k8s-api-844c84d7b6-z8547   1/1     Running   0          49m   10.244.0.13   opsknight-cluster-control-plane
   ```
   - Active ReplicaSet Hash: `844c84d7b6`.
   - Age of pods: `49m`.

### 2.3 OpsKnight Governance & Approval Gate

- **Trigger**: Incident created `#cmvbh1wh` on `E2E Kubernetes Service`.
- **Safety Rule Enforced**: Automatic non-idempotent budget = 0. OpsKnight evaluated trigger and matched `E2E K8s Restart Recovery` (v2 pinned) under **Suggested**.
- **Execution Started**: `cmvbh35k8035mlnziokk9czlt`.
- **Approval Gate Enforced**:
  - Execution paused at `Waiting approval`.
  - Step 1 (`Restart Kubernetes deployment`) status transitioned to `WAITING_APPROVAL`.
  - Step parameters displayed: Deployment `ag-e2e-k8s-api`, namespace `opsknight-cert`, target `test-cert-agent-ui`.
- **Human Approval Interaction**:
  - Responder clicked `Approve exact plan` in OpsKnight UI.
  - Confirmed in modal dialog `Approve Restart Kubernetes deployment?`.
  - Cryptographic approval recorded: `Approved by OpsKnight Admin · Oct 17, 2026, 2:51 AM · a4fc11ac16a594cc…`.

### 2.4 Agent Dispatch & In-Cluster Execution

- In-cluster agent `test-cert-agent-ui` (`cmvbc66tm01c414mafgksn6zk`) inside pod `opsknight-agent-agent-575ccbc878-czdfc` received dispatch `cmvbh3oc20372lnzineaw8ajx.started`.
- Agent executed `kubectl rollout restart deployment/ag-e2e-k8s-api -n opsknight-cert`.

### 2.5 Post-Remediation Physical Proof

1. **New Pods & Fresh ReplicaSet**:

   ```bash
   kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide
   ```

   **Output**:

   ```text
   NAME                              READY   STATUS    RESTARTS   AGE   IP            NODE
   ag-e2e-k8s-api-84656fc84f-qvvg8   1/1     Running   0          42s   10.244.0.15   opsknight-cluster-control-plane
   ag-e2e-k8s-api-84656fc84f-xj9tx   1/1     Running   0          43s   10.244.0.14   opsknight-cluster-control-plane
   ```
   - **ReplicaSet Hash Replaced**: `844c84d7b6` → **`84656fc84f`** (Concrete proof of real rolling restart).
   - **Pod IPs Reallocated**: `10.244.0.12`/`13` → **`10.244.0.14`/`15`**.
   - **Pod Age**: 42 seconds.
   - **Ready Count**: 2/2 pods ready.

2. **Rollout Status Verification**:

   ```bash
   kubectl rollout status deployment/ag-e2e-k8s-api -n opsknight-cert
   ```

   **Output**:

   ```text
   deployment "ag-e2e-k8s-api" successfully rolled out
   ```

3. **OpsKnight UI Evidence**:
   - Execution status: `Succeeded` (100% complete, 2/2 steps).
   - Step 1 Output: `deployment.apps/ag-e2e-k8s-api restarted`.
   - Step 2 Output: `deployment "ag-e2e-k8s-api" successfully rolled out`.
   - Incident `#cmvbh1wh` timeline updated with 6 auditable events and resolved with contextual resolution note.
