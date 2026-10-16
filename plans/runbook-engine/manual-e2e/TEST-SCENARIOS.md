# OpsKnight Runbook Engine — Acceptance Test Scenarios

## Test Script A: Journey A — Fully Automatic Unattended Recovery

### Preconditions

1. OpsKnight web application accessible at `https://opssentinal.com`.
2. Authenticated user session with administrator role (`admin@opsknight.com`).
3. Outbound Agent `docker-host-agent` (`cmvbcv9lr02hz14mah9j953nm`) online and reporting healthy Docker runtime capability.
4. Target workload `ag-e2e-docker-api` running in Docker on host port 8095:8080 with configured `/health` endpoint.
5. Published Runbook `Automated Docker Container Recovery` pinned to immutable published version v2:
   - Step 1: `start_docker_container` (`DOCKER`, action: `start`, riskClass: `IDEMPOTENT_WRITE`, `requiresApproval: false`).
   - Step 2: `verify_docker_health` (`DOCKER`, action: `health`, riskClass: `READ_ONLY`).
6. Service `E2E Docker Service` configured with automation rule `Auto Remediation Docker API`:
   - Execution mode: `AUTOMATIC`.
   - Version strategy: `PINNED` (v2).
   - Trigger event: `INCIDENT_CREATED` (`Match all`, 0 conditions).
   - Signed policy check: Passed.

### Execution Steps

1. **Inject Failure**:
   - In terminal, execute: `docker stop ag-e2e-docker-api`.
   - Verify container state is `exited`.
   - Verify HTTP endpoint `http://127.0.0.1:8095/health` fails to respond.
2. **Declare Incident**:
   - Navigate to `https://opssentinal.com/services/cmvbffoig07q614marj783x7f`.
   - Click **Create Incident**.
   - Set Title: `CRITICAL: ag-e2e-docker-api container outage`.
   - Urgency: `HIGH`. Priority: `P1`.
   - Click **Create Incident**.
3. **Observe Automatic Remediation**:
   - Observe trigger evaluation in OpsKnight engine.
   - Verify execution `cmvbgk6v4021qlnzikqbbye1o` created in `AUTOMATIC` mode.
   - Verify execution bypasses approval gates (0 approvals required).
   - Verify `docker-host-agent` receives task envelope and starts container.
   - Verify Step 2 health verification passes.
   - Verify execution transitions to `Succeeded` (100% complete, 2/2 steps).
4. **Physical Verification**:
   - In terminal, execute: `docker inspect ag-e2e-docker-api --format '{{.State.Status}} {{.State.Health.Status}}'`.
   - Verify status is `running healthy`.
   - Execute: `curl -i http://127.0.0.1:8095/health`.
   - Verify HTTP 200 OK with `{"status":"healthy"}` and valid uptime.

---

## Test Script B: Journey B — Human-Approved Remediation

### Preconditions

1. OpsKnight web application accessible at `https://opssentinal.com`.
2. Kind cluster `opsknight-cluster` running with in-cluster Agent `test-cert-agent-ui` in `opsknight` namespace.
3. Target workload `ag-e2e-k8s-api` Deployment running with 2 replicas in `opsknight-cert` namespace.
4. Baseline pod names recorded (ReplicaSet hash `844c84d7b6`).
5. Published Runbook `E2E K8s Restart Recovery` pinned to immutable published version v2:
   - Step 1: `Restart Kubernetes deployment` (`KUBERNETES`, action: `rollout-restart`, riskClass: `NON_IDEMPOTENT`, `requiresApproval: true`).
   - Step 2: `Verify rollout status` (`KUBERNETES`, action: `rollout-status`, riskClass: `READ_ONLY`).
6. Service `E2E Kubernetes Service` configured with automation rule `E2E K8s Rollout Restart Rule`:
   - Execution mode: `SUGGESTED`.
   - Version strategy: `PINNED` (v2).
   - Target: `test-cert-agent-ui`.
   - Trigger event: `INCIDENT_CREATED`.

### Execution Steps

1. **Declare Incident**:
   - Navigate to `https://opssentinal.com/services/cmvbfg7yn07r614ma11le9p6n`.
   - Click **Create Incident**.
   - Set Title: `CRITICAL: Kubernetes ag-e2e-k8s-api deployment outage`.
   - Urgency: `HIGH`. Priority: `P1`.
   - Submit incident `#cmvbh1wh`.
2. **Review Suggested Workflow**:
   - Navigate to **Runbooks** tab on incident page.
   - Observe automatic safety constraint: Non-idempotent budget = 0 for unattended runs.
   - Verify rule matches and displays under **Suggested**.
   - Click **Preview execution**.
   - Review frozen plan: Version 2, checksum `0cd9e87ebb6f…`, Target `cmvbc66tm01c414mafgksn6zk`.
   - Check authorization checkbox: `I reviewed the target and authorize the planned writes`.
   - Click **Execute this plan**.
3. **Enforce Human Approval Gate**:
   - Execution `cmvbh35k8035mlnziokk9czlt` starts and halts at `Waiting approval`.
   - Step 1 status displays `WAITING_APPROVAL`.
   - Review step parameters: action `rollout-restart`, resource `deployment`, name `ag-e2e-k8s-api`, namespace `opsknight-cert`.
   - Click **Approve exact plan**.
   - In confirmation dialog (`[role="alertdialog"]`), click **Approve exact plan**.
   - Observe cryptographic approval timestamp and responder record.
4. **Observe Execution & Verification**:
   - Execution transitions to `Running`.
   - Agent `test-cert-agent-ui` receives task `cmvbh3oc20372lnzineaw8ajx.started` and executes rolling restart.
   - Step 2 executes `rollout-status` and verifies deployment successfully rolled out.
   - Execution transitions to `Succeeded` (100% complete, 2/2 steps).
5. **Physical Verification**:
   - In terminal, execute: `kubectl get pods -n opsknight-cert -l app=ag-e2e-k8s-api -o wide`.
   - Verify previous ReplicaSet `844c84d7b6` replaced with new ReplicaSet `84656fc84f`.
   - Verify 2/2 fresh pods running (Age < 1m).
   - Execute: `kubectl rollout status deployment/ag-e2e-k8s-api -n opsknight-cert`.
   - Verify command exits 0 with `deployment "ag-e2e-k8s-api" successfully rolled out`.
6. **Incident Resolution**:
   - In UI, navigate to incident `#cmvbh1wh`.
   - Verify audit timeline logs 6 distinct lifecycle events.
   - Click **Resolve Incident**.
   - Enter mandatory resolution note: `Successfully executed approved recovery runbook E2E K8s Restart Recovery v2. Deployment ag-e2e-k8s-api rolling restart completed, 2/2 pods healthy and verified.`.
   - Confirm resolution and verify status badge transitions to `RESOLVED`.
