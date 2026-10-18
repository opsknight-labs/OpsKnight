# OpsKnight Runbook Engine — Defect Register & Resolution Log

## 1. Defect Classification & Resolution Policy

Every defect discovered during physical qualification was root-cause analyzed, fixed in code, and verified with dedicated regression tests.

---

## 2. Discovered Defect Register

### Defect 1: Event Outbox Omitted Runbook Background Job Enqueue (P0)

- **Severity**: P0 (Blocker)
- **Component**: `src/lib/event-outbox.ts`
- **Symptom**: Incoming monitoring alerts created incidents but failed to trigger automated runbook execution.
- **Root Cause**: The transaction side-effect processor omitted queuing `RUNBOOK` background job with `kind: 'EVALUATE_TRIGGER'`.
- **Resolution**: Updated `src/lib/event-outbox.ts` to enqueue `RUNBOOK` jobs immediately upon incident ingestion.
- **Regression Test**: `tests/lib/event-outbox-runbook-trigger.test.ts` (PASS).
- **Physical Verification**: Confirmed zero-touch automated recovery in execution `cmvdq4m1g2whh4qmq6v850i1q`.

---

### Defect 2: Agent Systemd Status Step Treated Exit Code 3 as Command Failure (P1)

- **Severity**: P1 (High)
- **Component**: `agent/src/executor.ts`
- **Symptom**: Precheck steps on stopped systemd units failed with `COMMAND_FAILED`, blocking restart runbooks from executing. Inversely, treating exit code 3 as an unconditional success caused false positives during postcheck verification when a service remained dead.
- **Root Cause**: `systemctl status` returns standard LSB exit code 3 when a service is dead or inactive. The executor strictly rejected all non-zero exit codes.
- **Resolution**: Updated `agent/src/executor.ts` to contextually handle systemd exit codes: exit code 3 returns `SUCCEEDED` for status queries/precheck diagnostics, while returning `FAILED` with `errorCode: 'SERVICE_INACTIVE'` when an active service is required (`requireActive: true`, verification phase, or verification step naming). Exit code 4 returns `FAILED` with `errorCode: 'UNIT_NOT_FOUND'`.
- **Regression Test**: Added comprehensive exit code 0, 3 (precheck vs verification), 4, and timeout test cases in `tests/lib/runbooks/agent-executor.test.ts` (PASS, 23/23 tests).
- **Physical Verification**: Successfully executed systemd restart runbook `cmvdqqbdu2wyi4qmq7podn4f1` on `linux-native-host-agent`.

---

### Defect 3: Connection String Credential Sanitization (P1)

- **Severity**: P1 (Security)
- **Component**: `src/lib/logger.ts`
- **Symptom**: Connection URIs containing internal database hostnames without domain suffixes could escape regex masking.
- **Root Cause**: Regular expressions in logger sanitization assumed FQDNs for hostnames.
- **Resolution**: Hardened connection URI regex to redact passwords regardless of hostname syntax.
- **Regression Test**: `tests/lib/logger-buffer.test.ts` (PASS, 15/15 tests).
