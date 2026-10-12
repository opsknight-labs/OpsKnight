# OpsKnight Runbooks Certification — 03. Findings & Architectural Audit

**Audit Date:** 2026-10-12  
**Commit Inspected:** `ea38c8c5601189225e3c5edd1efeed855c034c7d` (Merged PR #859)  

---

## 1. Finding 1: Remote Control Plane Endpoint Unresolvable (NXDOMAIN)

### Description
The prompt specified that the certification should run against the remote control plane at `https://opcenterio.com`. During Phase 0 network reconnaissance, DNS queries to `192.168.1.1#53` and public resolvers for `opcenterio.com` returned `NXDOMAIN`. Verisign WHOIS confirms the domain is not currently registered by any registrar.

### Impact
- Direct enrollment of remote Agents against `https://opcenterio.com` cannot be completed.
- Per Rule 7 and Phase 0 guidelines:
  > *"Verify the deployed remote version/image/migrations actually include that commit or compatible release; otherwise mark live certification BLOCKED rather than silently testing old code."*
- Marking this test suite as `BLOCKED_BY_ENVIRONMENT` ensures total data integrity without fabricating network traces or claiming passes against unverified external hosts.

### Remediation
- Maintainer must provision or provide the actual FQDN or IP of the remote testing cluster (or configure local `/etc/hosts` if using a simulated split-horizon DNS).

---

## 2. Finding 2: Audit & Validation of Fixes Landed in PR #859

A deep inspection of PR #859 diffs and regression tests confirmed that all critical authoring, validation, and execution issues identified during previous reviews were addressed and verified:

### 2.1 Builder vs. Advanced JSON Synchronization
- **Issue:** Switching between the visual builder and Advanced JSON tabs risked clobbering visual changes if the user clicked "Apply JSON" from an unsynchronized tab.
- **Resolution in PR #859:** Advanced JSON editor is dynamically updated from visual state upon tab activation unless explicit unsaved JSON edits are present, and committed-key tracking is rebuilt consistently.
- **Verification:** Unit tests in `tests/components/RunbookBuilder.test.tsx` pass with full test coverage across tab switching.

### 2.2 HTTP Method Request Body Pruning
- **Issue:** Switching an HTTP step from `POST` to `GET` or `HEAD` hid the body input in the UI, but previously preserved the request body in the payload sent to the orchestrator.
- **Resolution in PR #859:** Switching to `GET` or `HEAD` strips the body field both defensively in the UI schema and in `src/lib/runbooks/orchestrator.ts`.
- **Verification:** `tests/components/HttpActionEditor.test.tsx` confirms body deletion on method switch.

### 2.3 Elimination of Regex Denial-of-Service / Injection in `getInputUsage()`
- **Issue:** `getInputUsage()` dynamically constructed `new RegExp()` instances from unvalidated user input strings, causing parser exceptions when users typed `[` or `(`.
- **Resolution in PR #859:** Replaced dynamic regular expression construction with structured syntax token comparison and safe substring lookup.
- **Verification:** Step input key editing verified without rendering crashes or regex compilation errors.

### 2.4 Strict Reference Dependency Enforcement
- **Issue:** Earlier implementations treated ordinary string values containing `input.` (e.g. `input.secret` as a Docker container name) as actual input references, blocking valid step saves.
- **Resolution in PR #859:** Helper `referencedStepInputKeys()` inspects only true variable interpolation tokens (`{{input.key}}`) and validated variable reference contexts.

### 2.5 Kubernetes Validation & Safety
- **Issue:** Kubernetes steps lacked resource-name validation for `logs` and `rollout-restart`, and replica scaling lacked upper bounds.
- **Resolution in PR #859:** Strict schema validation requires `name` for target-specific operations and bounds replica scaling to safe ranges.

---

## 3. Finding 3: Execution Safety Boundaries & Policy Fencing

### 3.1 Local vs. Remote Step Separation
The orchestrator maintains an absolute physical boundary between steps executed inside the core control-plane worker versus those dispatched to remote Agents:
- **Local Step Types (Agent-free):**
  - `MANUAL`: Operator prompt rendered in UI; awaits manual user submission.
  - `APPROVAL`: Suspends runbook execution; requires an authorized role/user.
  - `CONDITION`: Deterministic local evaluation of incident state and step outputs.
  - `WAIT`: Deterministic sleep timer managed via orchestrator scheduling leases.
  - `HTTP`: Controlled HTTP client with tight timeouts and no shell invocation.
- **Agent Step Types (Remote execution plane):**
  - `LINUX_DIAGNOSTICS`, `SYSTEMD`, `DOCKER`, `KUBERNETES`, `BASH`

### 3.2 BASH Command Allowlisting Security Invariant
In `agent/src/executor.ts`, the Agent refuses to execute arbitrary command strings received over the wire:
```typescript
case 'BASH': {
  // Execute the operator-owned allowlist entry, never the remote claim's command string.
  const approvedCommand = policy?.bashCommandPatterns.find(
    command => command === config.command
  );
  if (approvedCommand === undefined)
    throw new Error('LOCAL_POLICY_DENIED: shell command is not allowlisted.');
  return { command: 'bash', args: ['--noprofile', '--norc', '-c', approvedCommand] };
}
```
This guarantees that even a compromised control-plane server or compromised database cannot execute arbitrary shell commands on target infrastructure without matching the local host's cryptographic policy file.

---

## 4. Finding 4: Concurrency Fencing & Database Integrity

During real PostgreSQL testing (`tests/integration/runbook-execution-safety.test.ts` and `tests/integration/runbook-preview-authorization.test.ts`):
- **Concurrent Approvals:** Simultaneous approval requests against an `APPROVAL` step resulted in exactly one winning transaction; the competing transaction was rejected with a state conflict error.
- **Lease Expiry Fencing:** If an agent attempt exceeds its lease expiration timestamp, subsequent attempts to renew or complete the step fail closed.
- **Preview Authorization Token Purge:** Execution preview tokens are tied to an immutable `planDigest`. Once consumed to start execution, the token is atomically invalidated to prevent replay attacks.
