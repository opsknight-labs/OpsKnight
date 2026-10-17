# Phase 3 — Topology Certification: Real Workloads & Isolated Execution

**Status:** Certified & Verified  
**Date:** October 17, 2026  
**Infrastructure Under Test:** Mac Host (Apple Silicon arm64), Docker Engine 29.7.2, Kind Kubernetes Cluster v1.37.0

---

## 1. Supported Deployment Topologies

The OpsKnight Runbook Engine was validated across real physical and virtual topologies:

```
+-----------------------------------------------------------------------------------------+
|                                    Topology Overview                                    |
+-------------------------------------+---------------------------------------------------+
| 1. Docker Host Topology             | Agent runs in Docker container on host engine.   |
|                                     | Targets local containers via docker.sock.         |
| 2. Kubernetes Cluster Topology      | Agent runs as Deployment inside Kind cluster.     |
|                                     | Targets Deployments/Pods via in-cluster RBAC.     |
| 3. Podman Rootless Topology         | Agent configuration and socket contracts verified |
|                                     | for rootless $XDG_RUNTIME_DIR/podman/podman.sock. |
| 4. Linux Systemd Qualification      | Service unit configuration, schema, and policy    |
|                                     | allowlisting verified against systemctl contracts.|
+-------------------------------------+---------------------------------------------------+
```

---

## 2. Real Infrastructure Topologies Tested

### 2.1 Topology A: Docker Container Remediation

- **Agent Identifier:** `docker-host-agent` (ID: `cmvbcv9lr02hz14mah9j953nm`)
- **Container Name:** `opsknight-agent-cmvbcv9lr02hz14mah9j953nm-opsknight-agent-1`
- **Agent Image:** `opsknight-agent:local` (built from `agent/Dockerfile`)
- **Runtime Isolation:**
  - `read_only: true` (read-only rootfs)
  - `tmpfs: /tmp` (ephemeral temporary storage)
  - `user: opsknight-agent` (non-root)
  - Socket mount: `/var/run/docker.sock` with `--group-add 0`
- **Target Workload:** `ag-e2e-docker-api` (Image: `ag-e2e-docker-api:latest`, Port `8095:8080`)
- **Physical Healthcheck:** Native Docker `HEALTHCHECK` with `wget -qO- http://127.0.0.1:8080/health`.

### 2.2 Topology B: Kubernetes In-Cluster Remediation

- **Cluster:** Kind cluster `opsknight-cluster` (Kubernetes v1.37.0)
- **Agent Identifier:** `test-cert-agent-ui` (ID: `cmvbc66tm01c414mafgksn6zk`)
- **Pod Name:** `opsknight-agent-agent-575ccbc878-czdfc` in namespace `opsknight`
- **RBAC Role & Permissions:** ClusterRole allowlisting `deployments`, `pods`, `events` with verbs `get`, `describe`, `scale`, `rollout-restart`.
- **Target Workload:** Deployment `ag-e2e-k8s-api` (Image: `nginx:alpine`, 2 ready replicas) in namespace `opsknight-cert`.
- **Cluster Service:** `ag-e2e-k8s-api-svc` (ClusterIP `10.96.22.113:80`).
