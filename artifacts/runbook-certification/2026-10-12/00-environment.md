# OpsKnight Runbooks Certification — 00. Environment & Test Host

**Certification Date:** 2026-10-12  
**Target Git Branch:** `main`  
**Target Commit SHA:** `ea38c8c5601189225e3c5edd1efeed855c034c7d` (Merged OpsKnight PR #859)  
**Evaluator:** Antigravity Coding & System Verification Agent (Supervised by OpsKnight Maintainer)  

---

## 1. Local Host Specifications

| Parameter | Value | Verification Command & Result |
| :--- | :--- | :--- |
| **Operating System** | macOS 26.6.2 (Darwin arm64) | `sw_vers` -> ProductVersion: 26.6.2, Build: 25G83; `uname -m` -> arm64 |
| **Hardware Architecture** | Apple Silicon | Darwin Kernel Version 25.4.0, RELEASE_ARM64_T6041 |
| **Container Engine** | Docker Desktop 29.7.2 | `docker info` -> Server Version: 29.7.2, Context: `desktop-linux` |
| **Kubernetes Engine** | Kind (Kubernetes in Docker) | `kind version` -> kind v0.27.0 go1.24.0 darwin/arm64 |
| **Node.js Runtime** | Node v20.18.0 | `node -v` -> v20.18.0 |
| **Package Manager** | npm 10.8.2 | `npm -v` -> 10.8.2 |
| **Kubectl CLI** | Client v1.32.2 | `kubectl version --client` -> v1.32.2 |
| **PostgreSQL Engine** | PostgreSQL 15.19 (Alpine) | `compose-opsknight-db-1` on port 5432 (Healthy) |

---

## 2. Dedicated Certification Workloads & Clusters

### 2.1 Kind Cluster (`opsknight-runbook-cert`)
- **Cluster Name:** `opsknight-runbook-cert`
- **Control Plane Container:** `opsknight-runbook-cert-control-plane` (Node Image: `kindest/node:v1.37.0`)
- **Status:** Active, Ready
- **Certification Namespace:** `opsknight-cert`
- **Isolated Target Workload:**
  - Deployment: `cert-web`
  - Container Image: `nginx:stable-alpine`
  - Replicas: 1/1 Available, Ready
  - Purpose: Validates live Kubernetes step actions (`scale`, `rollout-status`, `logs`, `events`, `get`, `describe`) without impacting external or developer workloads.

### 2.2 Isolated Database Instances
- **Primary Live DB:** `opsknight_db` on `127.0.0.1:5432` (Untouched, preserved).
- **Dedicated Real-DB Integration Test Database:** `runbook_test` on `127.0.0.1:5432`.
  - Schema Status: 100% migrations applied up through `20261011130000_runbook_preview_authorization`.
  - Concurrency Fencing: Fully initialized.
- **Dedicated UI Test Database:** `runbook_ui_test` on `127.0.0.1:5432`.

---

## 3. Remote Control Plane Verification Audit

The certification instructions requested validating against remote control plane `https://opcenterio.com`.

### 3.1 Network & DNS Diagnostic Probes
```bash
$ nslookup opcenterio.com
Server:		192.168.1.1
Address:	192.168.1.1#53

** server can't find opcenterio.com: NXDOMAIN

$ curl -Iv https://opcenterio.com
* Could not resolve host: opcenterio.com
* Closing connection 6
curl: (6) Could not resolve host: opcenterio.com

$ whois opcenterio.com
No match for domain "OPCENTERIO.COM".
>>> Last update of whois database: 2026-10-12T04:47:31Z <<<
```

### 3.2 Formal Remote Status Determination
- **Result:** **`BLOCKED_BY_ENVIRONMENT`**
- **Rationale:** Under Rule 7 and Phase 0 directives of the Certification Plan:
  > *"Verify the deployed remote version/image/migrations actually include that commit or compatible release; otherwise mark live certification BLOCKED rather than silently testing old code."*
- Because the domain `opcenterio.com` is unregistered and resolves to `NXDOMAIN`, no live remote agent enrollment or external control-plane telemetry can be executed against this URL without fabricating data.
- Live testing and verification are therefore performed truthfully against the verified local release commit `ea38c8c56` on macOS arm64 with Kind and local PostgreSQL instances.
