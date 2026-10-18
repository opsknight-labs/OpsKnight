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
- **Symptom**: Precheck steps on stopped systemd units failed with `COMMAND_FAILED`, blocking restart runbooks from executing.
- **Root Cause**: `systemctl status` returns standard LSB exit code 3 when a service is dead or inactive. The executor strictly rejected all non-zero exit codes.
- **Resolution**: Updated `agent/src/executor.ts` to accept exit code 3 as `SUCCEEDED` when `step.type === 'SYSTEMD'` and `action === 'status'`.
- **Regression Test**: Added exit code 3 assertions in `tests/lib/runbooks/agent-executor.test.ts` (PASS, 20/20 tests).
- **Physical Verification**: Successfully executed systemd restart runbook `cmvdqqbdu2wyi4qmq7podn4f1`.

---

### Defect 3: Connection String Credential Sanitization (P1)

- **Severity**: P1 (Security)
- **Component**: `src/lib/logger.ts`
- **Symptom**: Connection URIs containing internal database hostnames without domain suffixes could escape regex masking.
- **Root Cause**: Regular expressions in logger sanitization assumed FQDNs for hostnames.
- **Resolution**: Hardened connection URI regex to redact passwords regardless of hostname syntax.
- **Regression Test**: `tests/lib/logger-redaction.test.ts` (PASS).
