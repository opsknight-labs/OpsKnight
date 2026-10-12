# OpsKnight Runbooks Certification — 04. Security Architecture & Threat Boundary Evaluation

**Audit Date:** 2026-10-12  
**Commit:** `ea38c8c5601189225e3c5edd1efeed855c034c7d`  

---

## 1. Cryptographic Plan Digest & Tamper Resistance

### 1.1 SHA-256 Plan Digest
Before a runbook is executed, the orchestrator computes a canonical SHA-256 `planDigest` from:
1. Pinned Runbook Definition Checksum
2. Resolved step execution graph and step configurations
3. Normalized step inputs and runtime bindings
4. Incident context snapshot (id, severity, service, tags)

```typescript
// Canonical definition checksum
computeDefinitionChecksum(definition: RunbookDefinition): string
// Canonical plan digest
computePlanDigest(plan: ExecutionPlan): string
```

### 1.2 Invariant Verification
During real PostgreSQL integration testing:
- Modifying incident title, description, urgency, priority, or tags between preview generation and execution start resulted in immediate execution rejection:
  ```
  ✓ rejects changed title context before starting
  ✓ rejects changed priority context before starting
  ✓ rejects changed urgency context before starting
  ```
- Any discrepancy between the authorized `planDigest` and the submitted request aborts without creating execution records.

---

## 2. Asymmetric Execution Envelope Signing (Ed25519)

### 2.1 The Wire Protocol
When an Agent claims a step execution attempt:
1. The control plane generates an attempt envelope containing:
   - `attemptId`, `executionId`, `stepKey`, `riskClass`
   - `leaseToken`, `leaseExpiresAt`, `executionDeadlineAt`
   - `definitionChecksum`, `planDigest`
   - `inputValues`, `secretInputKeys`
2. The envelope is signed using the control plane's private Ed25519 signing key.
3. The Agent verifies the signature using the pinned public key before evaluating or executing any step action.

```typescript
// Envelope signature verification
verifyExecutionEnvelope(envelope: ExecutionEnvelope, publicKey: KeyObject): boolean
```

### 2.2 Replay & Man-in-the-Middle Protection
- **Lease Token Hash:** The lease token is cryptographically hashed with SHA-256 and verified upon each renewal.
- **Timestamp Fences:** Envelopes with expired deadlines or expired leases are rejected by the Agent runtime before execution.
- **Key Rotation Support:** The system supports multi-key staging, activation, and retirement verified by `tests/lib/encryption-keyring-rotation.test.ts` and `tests/integration/encryption-migration.test.ts`.

---

## 3. Secret Isolation & Confidential Parameter Handling

### 3.1 Field-Level Encryption
- Sensitive step inputs and credentials are encrypted at rest using AES-256-GCM authenticated encryption.
- Encrypted values are stored with key ID prefixes to support zero-downtime key rotation.

### 3.2 Scrubbing and Audit Fencing
- Secret inputs identified by `secretInputKeys` are scrubbed before emitting audit events.
- Audit logs contain cryptographic fingerprints of inputs and plan digests rather than raw secret values.
- Agent logs truncate output buffers to prevent credential leakage in verbose error logs.

---

## 4. Agent Policy Engine & Least Privilege

### 4.1 Local Policy Enforcement
The Agent does not rely solely on the control plane's intent. It enforces an independent, locally maintained JSON policy (`policy.json`):
- **BASH Allowlist:** Arbitrary shell strings are prohibited. Only strings strictly matching `bashCommandPatterns` in local policy are executed.
- **Kubernetes Boundaries:** Namespace targeting is restricted to allowlisted namespaces; prohibited actions (e.g. `delete`, `edit`) are rejected at the argument parser.
- **Systemd Restrictions:** Permitted actions are restricted to `status`, `start`, `stop`, `restart`, and `logs`. Unit names must match allowlisted service patterns.
- **Docker Scope:** Direct socket access is constrained to inspecting, logging, and restarting designated containers; privileged container creation is denied.

---

## 5. RBAC & Page-Level Guards

- All runbook API endpoints enforce strict RBAC permissions via `getUserPermissions()`:
  - `RUNBOOK_VIEW`: Read-only access to published runbooks and execution history.
  - `RUNBOOK_EDIT`: Authoring draft runbooks and configuring bindings.
  - `RUNBOOK_EXECUTE`: Triggering manual execution or approving `APPROVAL` steps.
  - `RUNBOOK_ADMIN`: Publishing, retiring, or altering signing keys.
- Architecturally guarded by `tests/architecture/rbac-page-guards.test.ts` (15 tests passed).
