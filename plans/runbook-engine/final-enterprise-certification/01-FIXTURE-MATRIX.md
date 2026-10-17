# OpsKnight Runbook Engine — Phase 1: Local Certification Lab Matrix

## 1. Overview & Topology

The certification lab consists of dedicated, disposable physical targets operating across four distinct runtime environments: host Docker daemon on macOS, Kubernetes (Kind cluster `opsknight-cluster`), Native Linux systemd inside the Linux control plane node, rootless Podman inside the Linux node, and native Docker Swarm.

---

## 2. Target Fixture Matrix

| Lab   | Fixture Name                       | Platform / Runtime                          | Address / Port                                | Health Endpoint | Verification Baseline                                               | Failure Injection Method                                                 | Cleanup Procedure                                   |
| ----- | ---------------------------------- | ------------------------------------------- | --------------------------------------------- | --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| **A** | `cert3-docker-api`                 | Docker Container (Mac)                      | `http://127.0.0.1:8097`                       | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-docker-api"}`        | `docker stop cert3-docker-api`                                           | `docker rm -f cert3-docker-api`                     |
| **B** | `cert3-docker-direct-api`          | Direct Docker Container (Mac)               | `http://127.0.0.1:8098`                       | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-docker-direct-api"}` | `docker stop cert3-docker-direct-api`                                    | `docker rm -f cert3-docker-direct-api`              |
| **C** | `cert3-k8s-api`                    | Kubernetes Deployment (2 replicas, Kind)    | ClusterIP `cert3-k8s-api.opsknight-cert3.svc` | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-k8s-api"}`           | `kubectl scale deployment cert3-k8s-api -n opsknight-cert3 --replicas=0` | `kubectl delete namespace opsknight-cert3`          |
| **D** | `cert3-k8s-api` (Kustomize target) | Kubernetes Deployment (Kind)                | ClusterIP `cert3-k8s-api.opsknight-cert3.svc` | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-k8s-api"}`           | Container kill / replica scale                                           | `kubectl delete namespace opsknight-cert3`          |
| **E** | `cert3-systemd-api.service`        | Native Linux Systemd Unit (Kind Linux Node) | `http://127.0.0.1:8099`                       | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-systemd-api"}`       | `systemctl stop cert3-systemd-api.service`                               | `systemctl disable --now cert3-systemd-api.service` |
| **F** | `cert3-podman-api`                 | Rootless Podman Container (Kind Linux Node) | `http://127.0.0.1:8100`                       | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-podman-api"}`        | `podman stop cert3-podman-api`                                           | `podman rm -f cert3-podman-api`                     |
| **G** | `cert3-swarm-api`                  | Docker Swarm Service (Mac Swarm Mode)       | `http://127.0.0.1:8101`                       | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-swarm-api"}`         | `docker service scale cert3-swarm-api=0`                                 | `docker service rm cert3-swarm-api`                 |
| **H** | `cert3-k8s-api` (Shared Pool)      | Shared Kubernetes Deployment (Kind)         | ClusterIP `cert3-k8s-api.opsknight-cert3.svc` | `/health`       | `HTTP 200 {"status":"healthy","service":"cert3-k8s-api"}`           | Agent node failure / disconnect                                          | `kubectl delete namespace opsknight-cert3`          |

---

## 3. Physical Preflight Verification Receipts

All 6 fixtures independently verified active and returning healthy responses prior to enrollment:

```bash
=== 1. cert3-docker-api ===
{"status":"healthy","service":"cert3-docker-api"}

=== 2. cert3-docker-direct-api ===
{"status":"healthy","service":"cert3-docker-direct-api"}

=== 3. cert3-k8s-api ===
{"status":"healthy","service":"cert3-k8s-api"}

=== 4. cert3-systemd-api ===
{"status":"healthy","service":"cert3-systemd-api"}

=== 5. cert3-podman-api ===
{"status":"healthy","service":"cert3-podman-api"}

=== 6. cert3-swarm-api ===
{"status":"healthy","service":"cert3-swarm-api"}
```
