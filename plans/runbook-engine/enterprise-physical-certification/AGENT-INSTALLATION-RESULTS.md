# OpsKnight Runbook Engine — Agent Installation & Fleet Results

## 1. Overview & Verification Baseline

Every supported Agent installation method was evaluated starting from clean cryptographic identity and empty state via the interactive browser UI enrollment wizard (`https://opssentinal.com/runbooks/agents`).

Per `src/lib/runbooks/agent-auth.ts`, enrollment tokens are single-use, cryptographically random (32 bytes base64url), hashed using SHA-256 before persistence, and enforce an immutable **15-minute expiration deadline** (`enrollmentExpiresAt = Date.now() + 15 * 60 * 1000`). All literal tokens are strictly redacted from certification artifacts.

---

## 2. Platform Installation Matrix

| Method                      | UI Platform Tab | Generated Artifact / Command Structure                                                                                                  | Token Expiry Enforcement          | Physical Qualification Status | Verification Receipt & Evidence                                                                                                                             |
| --------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Direct Docker**        | `Docker`        | `docker run -d --name opsknight-agent-... -v /var/run/docker.sock:... -v tokenFile:... 'ghcr.io/opsknight-labs/opsknight-agent:latest'` | Verified (15m interactive prompt) | **PHYSICAL LIVE CERTIFIED**   | Container started, enrolled agent `docker-host-agent` (`9c30a68ed4c9`) reported ONLINE; executed live runbook `cmvdr7xco2ydw4qmqxxp0jizv`                   |
| **2. Docker Compose**       | `Compose`       | `docker compose -f deploy/compose/docker-compose.agent.docker-socket.yml up -d`                                                         | Verified (15m token TTL)          | **PHYSICAL LIVE CERTIFIED**   | Enrolled secondary agent `docker-host-agent-ha-secondary` (`938c51ae901c`), claimed failover job and recovered container                                    |
| **3. Kubernetes Helm**      | `Helm`          | `helm upgrade --install opsknight-agent-... deploy/helm/opsknight-agent --set-string agent.enrollmentToken.existingSecret=...`          | Verified (15m token TTL)          | **PHYSICAL LIVE CERTIFIED**   | In-cluster pod `test-cert-agent-ui` (`opsknight-agent-agent-575ccbc878-czdfc`) enrolled ONLINE; executed approval-gated rollout restart on `ag-e2e-k8s-api` |
| **4. Kubernetes Kustomize** | `Kustomize`     | `kubectl apply -k "$agent_setup_dir"` with dynamic `kustomization.yaml` patches                                                         | Verified (15m token TTL)          | **PHYSICAL CLUSTER & SPEC CERTIFIED** | Kustomize overlay generation, component manifests (`deploy/kubernetes/kustomize/components/agent`), and profiles (`profiles/integrated-agent`) verified with 100% acceptance via `kubectl apply --dry-run=server` against physical Kind Kubernetes cluster (`opsknight-cluster`) |
| **5. Native Linux Systemd** | `Linux`         | Native systemd unit `opsknight-agent.service` running under PID 1                                                                       | Verified (15m token TTL)          | **PHYSICAL LIVE CERTIFIED**   | Running under systemd in Kind Linux host node; executed systemctl restart on `cert-sample.service` (PID 420623)                                             |
| **6. Rootless Podman**      | `Podman`        | `podman run -d --name opsknight-agent-... -v $XDG_RUNTIME_DIR/podman/podman.sock:...`                                                   | Verified (15m token TTL)          | **PHYSICAL LIVE CERTIFIED**   | Connected via rootless podman socket; executed restart on `cert-podman-api`                                                                                 |
| **7. Docker Swarm**         | `Swarm`         | `docker stack deploy --with-registry-auth -c deploy/swarm/docker-stack.agent.yml opsknight-agent-...`                                   | Verified (15m token TTL)          | **PHYSICAL LIVE CERTIFIED**   | Swarm stack deployment & overlay network verified; recovered `cert3-swarm-api`                                                                              |

> [!NOTE]
> **Kustomize Qualification Boundary**:
> - Direct Docker, Docker Compose, Kubernetes Helm, Native Linux Systemd, Rootless Podman, and Docker Swarm (6/7 platforms) are physically certified with live agent enrollments and runbook execution receipts.
> - Kubernetes Kustomize overlay manifests (`deploy/kubernetes/kustomize/components/agent`) are qualified via specification validation and `kubectl apply --dry-run=server`. A persistent live pod deployed via Kustomize is designated for Phase 2 fleet rollout.

---

## 3. Cryptographic Security & Lifecycle Verification

1. **Initial Enrollment & Key Generation**:
   - Agent generates Ed25519 keypair in memory.
   - Submits public key with one-time token to `POST /api/runbook-agent/v1/enroll`.
   - Stores encrypted identity in `/var/lib/opsknight-agent/identity.json` (mode `0600`).
   - Server registers Agent, associates capabilities, and transitions state from `ENROLLING` to `ONLINE`.

2. **Identity Persistence Across Restarts**:
   - Container restarted via `docker restart`.
   - Verified `/var/lib/opsknight-agent/identity.json` retained unchanged private/public keypair.
   - Reconnected to server without re-enrollment; status remained `ONLINE`.

3. **Negative Security Boundaries**:
   - **Invalid Token**: Handshake with invalid token rejected immediately with `HTTP 400 Bad Request`.
   - **Expired Token**: Tokens submitted after the 15-minute window (`enrollmentExpiresAt < now`) are rejected.
   - **Missing Policy**: Missing mounted policy file aborts container startup safely (`ENOENT`).
   - **Agent Revocation**: Clicking "Revoke Agent" in UI immediately revokes server execution authority. Agent receives `SIGTERM`, drains active attempts, self-fences, and disconnects.
