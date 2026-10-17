# OpsKnight Runbook Engine — Security & Governance Evidence

## 1. Cryptographic Envelope Signing (Ed25519)

All task dispatches from the OpsKnight control plane to outbound agents are signed with asymmetric Ed25519 cryptographic keypairs:

- **Public Key Identity**: Mounts via `OPSKNIGHT_EXECUTION_PUBLIC_KEY` secret within agent pods/containers.
- **Envelope Verification**: Agents refuse execution and emit `SIGNATURE_VERIFICATION_FAILED` if envelopes fail signature check or have expired timestamps.
- **Proof**: Journey A and Journey B tasks were signed by control-plane master key and cryptographically validated by `docker-host-agent` and `test-cert-agent-ui`.

---

## 2. Agent Local Policy Enforcement (`policy.json`)

OpsKnight agents do not grant arbitrary execution authority. Every agent enforces an immutable local policy (`/etc/opsknight-agent/policy.json`):

- **Whitelisted Actions**:
  - `allowedStepTypes`: `["LINUX_DIAGNOSTICS", "KUBERNETES", "BASH"]`
  - `kubernetesActions`: `["get", "describe", "logs", "events", "rollout-status", "scale", "rollout-restart"]`
  - `allowNonIdempotent`: `true` (enables non-idempotent writes only when accompanied by signed approval tokens)
- **Denial Testing**:
  - During early testing, steps attempting cluster-admin or non-whitelisted namespaces were rejected with code `DENIED` (`LOCAL_POLICY_DENIED` and `RBAC Forbidden`).

---

## 3. Automatic Remediation Risk Budgets & Blast Radius

To prevent runaway automated damage during cascading outages, OpsKnight enforces strict system limits:

- `runbookAutoExecutionsPerIncident`: Max 3.
- `runbookAutoWritesPerIncident`: Max 3.
- `runbookAutoNonIdempotentPerIncident`: **0 (Hard default)**.
- **Security Invariant Verified**:
  - In Journey A, `DOCKER start` is classified as `IDEMPOTENT_WRITE`, consuming idempotent budget and completing unattended.
  - In Journey B, `KUBERNETES rollout-restart` is classified as `NON_IDEMPOTENT`. Because non-idempotent budget is 0, automatic unattended execution is strictly prohibited. The system safely converted the rule trigger into a **Suggestion**, requiring responder intervention.

---

## 4. Human Approval Gate Verification

- Step approval is mandatory for:
  1. `APPROVAL` step types.
  2. `MANUAL` step types.
  3. `NON_IDEMPOTENT` risk class actions.
  4. Any step where `requiresApproval === true`.
- **Approval Lifecycle Invariant**:
  - An execution reaching an unapproved step halts in state `WAITING_APPROVAL`.
  - The frozen plan displays exact parameters, targets, timeouts, and risk class.
  - Approval is double-confirmed via an interactive `AlertDialog` modal.
  - The approval record stores responder ID, timestamp, and signature digest in the immutable execution audit log.

---

## 5. Version Immutability & Checksum Tamper Resistance

- Runbook versions (`v1`, `v2`) are sealed upon publication.
- Definition hashes (SHA-256) are validated on every execution preflight.
- If a draft or retired version definition changes, `RunbookDefinitionError` halts dispatch.
- Pinned rules execute strictly against their frozen checksum.
