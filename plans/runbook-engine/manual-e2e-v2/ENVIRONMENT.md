# OpsKnight Runbook Engine — Enterprise E2E Certification: Environment

**Document Version:** 2.1.0-cert2  
**Date:** October 17, 2026  
**Auditor:** Antigravity Advanced Agentic Coding Pair  
**Repository:** `https://github.com/opsknight-labs/OpsKnight`  
**Working Branch:** `feat/runbook-full-automatic-e2e-certification`  
**Control Plane SaaS:** `https://opssentinal.com` (Control Plane Server Revision: Next.js v15.5.9 on production cluster)  
**Local Test Candidate Revision:** Commit `01f768f37` (HEAD)  
**Agent Core Revision:** `opsknight-agent:local` (v2.1.0-cert2) built from `agent/src/index.ts`

---

## 1. Physical Host System Specifications

| Component               | Specification / Value                                  | Notes                                   |
| :---------------------- | :----------------------------------------------------- | :-------------------------------------- |
| **Host Machine**        | Apple MacBook Pro (Apple Silicon M-series)             | ARM64 architecture                      |
| **Operating System**    | macOS Sequoia (Darwin 24.3.0, arm64)                   | Native host runtime                     |
| **Node.js Runtime**     | Node.js v22.23.2                                       | Active development & local test runtime |
| **OpenSSL Version**     | OpenSSL 3.5.7                                          | Host cryptographic subsystem            |
| **Docker Engine**       | Docker Engine 29.7.2 / Docker Desktop 4.41.0           | Container virtualization daemon         |
| **Kind Kubernetes**     | Kind v0.31.0 running node image `kindest/node:v1.37.0` | In-cluster test runtime                 |
| **PostgreSQL Runtime**  | PostgreSQL 16.8 (port 55432 & port 55442)              | Development & isolation verification    |
| **Interactive Browser** | Google Chrome Headless/Direct with CDP on port 9222    | Browser-first operations                |

---

## 2. Infrastructure Topologies Under Test

```
+---------------------------------------------------------------------------------------------------+
|                                 Multi-Topology Certification Fleet                                |
+--------------------------+-----------------------+------------------------+-----------------------+
| Topology                 | Agent Installation    | Managed Target         | Health Verification   |
+--------------------------+-----------------------+------------------------+-----------------------+
| 1. Docker Host Engine    | Direct Docker Run     | cert2-docker-api       | HTTP GET :8096/health |
|                          | & Docker Compose      | Container (nginx/api)  | Docker State.Health   |
+--------------------------+-----------------------+------------------------+-----------------------+
| 2. Kubernetes Kind Clust.| Helm Chart Deployment | cert2-k8s-api          | In-Cluster HTTP Probe |
|                          | & Kustomize Manifests | Deployment (2 replicas)| K8s ReadyReplicas 2/2 |
+--------------------------+-----------------------+------------------------+-----------------------+
| 3. Podman Rootless Eng.  | Rootless Container    | cert2-podman-api       | Rootless UNIX Socket  |
|                          | with CONTAINER_HOST   | Container Target       | HTTP GET Probe        |
+--------------------------+-----------------------+------------------------+-----------------------+
| 4. Native Linux Systemd  | Native Systemd Daemon | cert2-linux-api.service| systemctl is-active   |
|                          | with Polkit Rules     | Systemd Unit           | HTTP GET Probe        |
+--------------------------+-----------------------+------------------------+-----------------------+
| 5. Docker Swarm Clust.   | Swarm Service Daemon  | cert2-swarm-api        | docker service ps     |
|                          | Host Mount Volume     | Container Target       | Swarm Tasks Healthy   |
+--------------------------+-----------------------+------------------------+-----------------------+
```

---

## 3. Container Images & Digests

| Image Reference            | Repository / Tag                 | Digest / ID              | Purpose                               |
| :------------------------- | :------------------------------- | :----------------------- | :------------------------------------ |
| `opsknight-agent:local`    | Local build (`agent/Dockerfile`) | `sha256:9c30a68ed4c9...` | Outbound certification agent          |
| `kindest/node:v1.37.0`     | Docker Hub (`kindest/node`)      | `sha256:fa5058784b35...` | Kind Kubernetes cluster control-plane |
| `nginx:alpine`             | Docker Hub library               | `sha256:4ab66a69a8a9...` | Breakable Docker HTTP API fixture     |
| `ag-e2e-docker-api:latest` | Local test fixture               | `sha256:73282e1756ce...` | Healthchecked Node API container      |
| `postgres:16-alpine`       | Docker Hub library               | `sha256:970d6ec3a771...` | Isolation DB engine                   |

---

## 4. Network Endpoints & Ports

| Port / Address            | Protocol / Service | Bound Entity                  | Description                     |
| :------------------------ | :----------------- | :---------------------------- | :------------------------------ |
| `https://opssentinal.com` | HTTPS (443)        | Cloudflare / Next.js          | Remote SaaS Control Plane       |
| `127.0.0.1:3000`          | HTTP               | Local Next.js dev server      | Local candidate UI verification |
| `127.0.0.1:9222`          | HTTP / WebSocket   | Chrome Remote Debugging       | Antigravity CDP browser bridge  |
| `0.0.0.0:8095`            | HTTP               | Container `ag-e2e-docker-api` | Port-mapped test API endpoint   |
| `0.0.0.0:8096`            | HTTP               | Container `cert2-docker-api`  | Port-mapped breakable test API  |
| `127.0.0.1:53245`         | HTTPS (6443)       | Kind Control-Plane            | Kubernetes API Server           |
| `127.0.0.1:55432`         | TCP                | PostgreSQL daemon             | Local certification testing DB  |
| `127.0.0.1:9090`          | HTTP               | Prometheus Server             | Real external monitor           |
| `127.0.0.1:9093`          | HTTP               | Alertmanager Server           | Alert notification engine       |
| `127.0.0.1:9115`          | HTTP               | Blackbox Exporter             | HTTP/TCP endpoint probe engine  |
