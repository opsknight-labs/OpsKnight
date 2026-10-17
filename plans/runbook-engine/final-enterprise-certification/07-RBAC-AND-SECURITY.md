# OpsKnight Runbook Engine — Phase 8: RBAC, Cryptographic Envelopes & Security Boundaries

## 1. Overview & Security Architecture

OpsKnight enforces strict zero-trust security boundaries across its entire runbook orchestration stack:

1. **Multi-Tenant RBAC Enforcement**: Role-based access control guarding all service bindings, rule mutations, and runbook definitions.
2. **Cryptographic Execution Envelopes**: Ed25519 signing of all commands sent to agents, ensuring end-to-end payload integrity and non-repudiation.
3. **Secret Masking & Redaction**: Automated sanitization of secrets, tokens, passwords, and sensitive inputs across UI views, logs, and database records.
4. **Agent Enrollment & Revocation Boundaries**: Ephemeral single-use enrollment tokens (15-minute TTL), mutual TLS/HTTPS authentication, and instantaneous revocation fences.
5. **Server Action Error Hardening**: Public Server Action responses mask internal database and infrastructure exceptions, returning clean generic errors to prevent information disclosure.

---

## 2. RBAC Guard Suite & Test Evidence

All authorization boundaries were verified with automated test suites ensuring responders and unauthorized actors cannot mutate or trigger unauthorized workflows:

### Automated Test Pass Receipts

- `npm run test:authorization`:
  - `tests/lib/rbac-read-guards.test.ts` — **20/20 PASS**
  - `tests/architecture/rbac-page-guards.test.ts` — **15/15 PASS**
- `npx vitest run tests/lib/runbooks/service-rule-management-rbac.test.ts`:
  - Denies attach to non-authorized responders — **PASS**
  - Denies edit to non-authorized responders — **PASS**
  - Denies trigger edit to non-authorized responders — **PASS**
  - Denies detach to non-authorized responders — **PASS**
  - Denies pause to non-authorized responders — **PASS**
  - Denies duplicate to non-authorized responders — **PASS**
  - Denies activate to non-authorized responders — **PASS**
  - Denies policy check requests to non-authorized responders — **PASS**
  - Enforces administrator service modification boundary — **PASS**
- `npx vitest run tests/lib/runbooks/check-rule-policy-action.test.ts`:
  - Returns structured `userMessage` for expected `RunbookError` validation failures — **PASS**
  - Masks unexpected internal/database errors with generic message and logs to console — **PASS**
  - Revalidates path and returns policy check result on success — **PASS**

Total RBAC and Server Action security automated test assertions: **47/47 passed (100%)**.

---

## 3. Cryptographic Envelopes & Agent Signature Verification

Every command dispatched from OpsKnight to an Agent is encapsulated in an Ed25519-signed execution envelope:

- **Key Generation & Management**: Server generates Ed25519 keypairs stored in secure environment vaults.
- **Signing Pipeline**: `signExecutionEnvelope` attaches a cryptographic signature to the canonical JSON representation of each execution step.
- **Agent Verification**: Prior to invoking any subprocess, container runtime, or systemd daemon, the agent validates the signature against the server's registered public key.
- **Tamper Protection**: Any alteration of command parameters, timeouts, or target identifiers immediately causes signature validation failure and execution rejection on the agent (`execution-signing.test.ts`).

---

## 4. Secret Redaction & Token Fencing

| Security Boundary               | Tested Scenario                                | Expected Outcome                                       | Verified Result                                 | Status   |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------- | -------- |
| **Secret Masking**              | Runbook input with type `SECRET_REF`           | UI and audit logs replace value with `[REDACTED]`      | Secrets never exposed in DOM or server logs     | **PASS** |
| **Server Action Error Masking** | Unexpected DB error in policy check            | Raw database query/connection error suppressed         | Returns generic public message, logs internally | **PASS** |
| **Alert Integration Auth**      | Ingestion request with invalid bearer token    | Reject with HTTP 403 Forbidden                         | Request aborted, no incident created            | **PASS** |
| **Malformed Ingestion**         | Ingestion request with corrupted JSON payload  | Reject with HTTP 400 Bad Request                       | Schema validation blocks processing             | **PASS** |
| **Agent Token Expiry**          | Enrollment attempted with expired token (>15m) | Agent enrollment rejected (`HTTP 400 / Invalid Token`) | Handshake denied                                | **PASS** |
| **Instant Revocation**          | Agent revoked via UI console                   | Agent immediately sent SIGTERM; reconnection blocked   | Socket severed, execution fenced                | **PASS** |
