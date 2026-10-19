# OpsKnight Runbook Engine — Phase 9: Fault Tolerance & Failure Recovery

## 1. Overview & Failure Recovery Principles

Enterprise runbook execution must withstand physical infrastructure failures, network partitions, operator cancellations, and precheck errors without creating runaway mutations or undefined states.

OpsKnight enforces the following safety controls:

1. **Fail-Fast Precheck Guards**: If a precheck step or health probe fails, all downstream mutation actions are aborted immediately.
2. **Graceful Operator Cancellation**: Operators can cancel an execution at approval gates or before dispatch; remaining steps are skipped.
3. **Deterministic Step Timeouts**: If an agent or target stalls beyond its configured deadline, execution transitions to `TIMED_OUT`.
4. **UNKNOWN Outcome Fencing**: If an agent loses contact mid-step, non-idempotent steps are fenced by `isSafeToRetryAfterUnknown` and never retried automatically.
5. **Immutable Execution Snapshot**: Executions run against an immutable frozen definition checksum captured at queue time.

---

## 2. Fault Scenarios & Evidence Level

| Scenario                          | Tested Condition                                         | System Response                                                                     | Evidence Level                                           | Status          |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------- |
| **Precheck Failure Guard**        | Unit inactive during precheck                            | Precheck fails; subsequent mutation steps aborted                                   | Physical Execution (`cmvc7pkss012xr4wgqw03xncs`)         | **CERTIFIED**   |
| **Approval-Gate Cancellation**    | Operator triggers `Cancel` while paused at approval gate | Execution halted; downstream mutation steps skipped                                 | UI Execution (`cmvc8nq9i03q1r4wgklbgtr2e`)               | **CERTIFIED**   |
| **In-Flight Write Cancellation**  | Cancel requested after physical process spawned          | Agent receives cancellation signal; step marked cancelled; **no physical rollback** | Architectural design; rollback is application-dependent  | **QUALIFIED**   |
| **Step Timeout Deadline**         | Container health check exceeds deadline window           | Timeout monitor fires; execution marked `TIMED_OUT`                                 | Vitest (`agent-executor.test.ts`)                        | **UNIT TESTED** |
| **UNKNOWN Outcome Fencing**       | Agent disconnects mid-execution                          | Engine marks step `UNKNOWN`; non-idempotent retry blocked                           | Code Guard (`types.ts:137` & `claim-disconnect.test.ts`) | **CODE GUARD**  |
| **Definition Snapshot Integrity** | Draft modified while execution is running                | Worker uses `definitionChecksum` captured at launch                                 | Immutable versioning model (`versions.test.ts`)          | **CERTIFIED**   |

---

## 3. Physical Receipts & Verification Logs

### Scenario A: Precheck Failure Abort (`cmvc7pkss012xr4wgqw03xncs`)

```text
Execution cmvc7pkss012xr4wgqw03xncs
- Step 1: Precheck systemd status -> Failed (Exit code 3, unit inactive)
- Step 2: Restart cert-sample.service -> SKIPPED (Aborted by precheck guard)
- Step 3: Verify systemd status -> SKIPPED
Final Execution Status: FAILED
Result: Downstream mutations aborted; 0 unwanted writes executed.
```

### Scenario B: Approval-Gate Operator Cancellation (`cmvc8nq9i03q1r4wgklbgtr2e`)

```text
Execution cmvc8nq9i03q1r4wgklbgtr2e
- Status: CANCELLED
- Cancelled by: OpsKnight Admin
- Cancellation Timestamp: Oct 17, 2026, 3:43 PM GMT+5:30
- Unexecuted steps safely terminated before physical dispatch.
```

> [!WARNING]
> **Cancellation Boundary Clarification**: Cancellation at an approval gate guarantees zero physical mutation. If cancellation is issued _after_ a physical write has already begun on an Agent host, OpsKnight cancels the task worker and stops downstream steps, but cannot undo changes already committed to the physical host (e.g. a container already restarted). Workloads requiring compensations must implement explicit compensation steps.
