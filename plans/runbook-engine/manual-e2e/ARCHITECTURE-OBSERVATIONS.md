# OpsKnight Runbook Engine — Architectural Observations & Recommendations

## 1. Architectural Highlights

### Outbound-Only Agent Polling (Zero Ingress Attack Surface)

OpsKnight agents initiate outbound HTTPS long-poll connections to the control plane. They require **zero incoming network ports**, zero load-balancer ingress rules, and zero exposed agent APIs on edge firewalls. This guarantees that internal corporate networks and air-gapped VPCs remain strictly isolated from external probe threats.

### Cryptographic Plan Freezing & Separation of Concerns

Before an execution begins, OpsKnight generates an immutable plan snapshot containing:

- Frozen runbook definition checksum.
- Resolved template inputs.
- Bound target agent/pool IDs.
- Individual step approval gates and timeouts.

This decouples execution integrity from live UI modifications: an administrator editing a draft runbook or updating service rules cannot mutate an in-flight execution.

### Multi-Tenant Agent Pools

Agent pools support two distinct operational models:

1. `SHARED_TARGET`: Worker agents share access to a single target system (e.g. Kubernetes cluster or database cluster). Any healthy pool member can service the request.
2. `LOCAL_HOSTS`: Agents represent individual, machine-specific physical hosts. Mutation steps targeting `LOCAL_HOSTS` enforce strict single-agent resolution to prevent accidental parallel writes to disparate servers.

---

## 2. Production Hardening Recommendations

1. **Agent Spool Auto-Pruning**:
   - The agent spool directory (`/var/lib/opsknight-agent/spool/dispatched`) accumulates `.started` marker files. A background cron or LRU garbage-collector should prune marker files older than 7 days to preserve filesystem inodes on long-running worker nodes.
2. **Dynamic In-Cluster Re-Authentication**:
   - In-cluster agents rely on Kubernetes Projected ServiceAccount tokens (default 1-hour expiration). Ensure periodic token re-read routines run before token expiry to support ultra-long daemon uptime without pod restarts.
3. **Optimistic Locking UI Feedback**:
   - When concurrent responders attempt to approve the same step, database transactions correctly ensure only one approval commits (`WHERE status = 'WAITING_APPROVAL'`). The UI should display a clean toast notification: "Step was already approved by [User]" instead of a generic refresh.
