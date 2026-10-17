# OpsKnight Runbook Engine — Phase 2: Agent Installation & Enrollment Matrix

## 1. Overview & Verification Scope

Every supported Agent installation method was evaluated starting from clean cryptographic identity and empty state via the interactive browser UI enrollment wizard (`https://opssentinal.com/runbooks/agents`).

Per `src/lib/runbooks/agent-auth.ts`, enrollment tokens are single-use, cryptographically random (32 bytes base64url), hashed using SHA-256 before persistence, and enforce an immutable **15-minute expiration deadline** (`enrollmentExpiresAt = Date.now() + 15 * 60 * 1000`). All literal tokens are strictly redacted from certification artifacts.

---

## 2. Platform Installation Matrix

| Method                      | UI Platform Tab | Generated Artifact / Command Structure                                                                                                                              | Token Expiry Enforcement                             | Qualification Status                                         | Verification Receipt                                                                                                             |
| --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **1. Direct Docker**        | `Docker`        | `docker run -d --name opsknight-agent-... -v /var/run/docker.sock:... -v tokenFile:... 'ghcr.io/opsknight-labs/opsknight-agent:latest'`                             | Verified (15m interactive token prompt)              | **LIVE CERTIFIED (DEPLOYMENT + RUNBOOK EXECUTION)**          | Container started, enrolled agent `cmvcefnby01s74qmqtfz4ygdc` reported ONLINE; executed live runbook `cmvchadqm09584qmqassxvp0s` |
| **2. Kubernetes Helm**      | `Helm`          | `helm upgrade --install opsknight-agent-... deploy/helm/opsknight-agent --set-string agent.enrollmentToken.existingSecret=...`                                      | Verified (15m token TTL)                             | **LIVE CERTIFIED (IN-CLUSTER AGENT + REMEDIATION)**          | In-cluster pod `test-cert-agent-ui` enrolled ONLINE; executed approval-gated rollout restart on `ag-e2e-k8s-api`                 |
| **3. Docker Compose**       | `Compose`       | `docker compose -p opsknight-agent-... -f deploy/compose/docker-compose.agent.yml -f deploy/compose/docker-compose.agent.enrollment-file.yml up -d opsknight-agent` | Verified (15m ephemeral token prompt + expiry badge) | **SPEC-VALIDATED (COMPOSE MANIFEST & ENROLLMENT FLOW)**      | Multi-file compose manifest structure, volume bindings, and interactive token injection validated via wizard                     |
| **4. Kubernetes Kustomize** | `Kustomize`     | `kubectl apply -k "$agent_setup_dir"` with dynamic `kustomization.yaml` patches                                                                                     | Verified (15m token TTL)                             | **SPEC-VALIDATED (KUSTOMIZE MANIFEST & JSON6902 PATCHES)**   | Kustomize overlay generation, SecretGenerator scoping, and JSON6902 patch structure validated via wizard                         |
| **5. Native Linux Systemd** | `Linux`         | Native installer distribution notice with containerized systemd agent runtime fallback                                                                              | Verified                                             | **SPEC-VALIDATED (SYSTEMD UNIT & HOST AGENT SPEC)**          | Systemd unit definition validated; executed commands through `linux-native-host-agent` host runtime                              |
| **6. Rootless Podman**      | `Podman`        | `podman run -d --name opsknight-agent-... -v $XDG_RUNTIME_DIR/podman/podman.sock:...`                                                                               | Verified (15m token TTL)                             | **SPEC-VALIDATED (PODMAN SOCKET & ROOTLESS CONTAINER SPEC)** | Rootless socket mount (`$XDG_RUNTIME_DIR`), cgroup configuration, and command generation validated via wizard                    |
| **7. Docker Swarm**         | `Swarm`         | `docker stack deploy --with-registry-auth -c deploy/swarm/docker-stack.agent.yml opsknight-agent-...`                                                               | Verified (15m token TTL)                             | **SPEC-VALIDATED (SWARM STACK & SECRET BINDING SPEC)**       | Swarm stack compose specification, overlay network binding, and secret configuration validated via wizard                        |

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
   - **Agent Revocation**: Clicking "Revoke Agent" in UI immediately revokes server execution authority. Agent receives `SIGTERM`, drains active attempts, self-fences, and disconnects. Subsequent restart attempts are rejected (`SIGTERM; draining and stopping`).
