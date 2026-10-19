# Service Automation ↔ Runbook integration

This guide is for operators enabling automatic remediation on services that already use Service Automation. It explains how a LIVE automation decision becomes trusted runbook input, what can and cannot run unattended, how verified recovery resolves incidents, and how to roll the feature out safely.

Everything described here is configured in the product UI and stored in the database. There are no new environment variables, feature flags or restarts. Service Automation is still the only routing engine: there is no `RUN_RUNBOOK` automation action, no separate workflow engine and no Redis dependency. Paging and remediation stay independent.

## Architecture and flow

```text
Alert (Events API / integration)
  │
  ▼  one database transaction (src/lib/events.ts)
┌───────────────────────────────────────────────────────────────────────────┐
│ prepareAutomation → persistAutomation                                     │
│   • LIVE decision: priority, route, pinned escalation policy               │
│   • immutable, checksummed response context (declared fields only)         │
│ initializeEscalationExecution → first ESCALATION job (paging scheduled)   │
│ enqueue RUNBOOK {kind: EVALUATE_TRIGGER} (new, non-flapping OPEN incidents)│
└───────────────────────────────────────────────────────────────────────────┘
  │ commit
  ├──────────────► ESCALATION lane: pages responders on the pinned policy.
  │                Never waits for, and is never paused by, a runbook.
  │
  └──────────────► RUNBOOK lane (isolated worker)
                     EVALUATE_TRIGGER
                       ├─ load verified context (same loader as execution)
                       ├─ match INCIDENT_CREATED trigger conditions
                       │    (incident.*, service.*, automation.<key>)
                       ├─ resolve context-mapped inputs + approved target
                       └─ AUTOMATIC → execution | SUGGESTED → suggestion
                     ADVANCE_EXECUTION ↔ Agent claim / fence / result
                       └─ write step: unattended only if authorized for the
                          exact pinned version, otherwise WAITING_APPROVAL
                     terminal → verification evidence → recovery decision
                       └─ RUNBOOK_VERIFIED / RUNBOOK_UNVERIFIED event
                       └─ VERIFIED_RESOLUTION job (only when opted in)
                     VERIFIED_RESOLUTION
                       └─ incident lifecycle RESOLVE (source SYSTEM)
                          → AUTO_RESOLVED event, escalation cancelled
```

Every arrow is a durable `BackgroundJob`. A crashed worker, a lost lease or a replayed job converges to the same result: one automatic execution per incident and binding, one resolution per execution.

## Immutable response context

When a LIVE automation decision is evaluated without a fallback, OpsKnight stores a **response context** on the incident's decision row:

- Only the active automation version's built-in and declared fields are captured (every built-in field plus up to 64 declared fields; an automation version that exceeds the limit fails with `CONTEXT_FIELD_LIMIT` instead of being truncated), with their value, state (`RECOGNIZED`, `MISSING`, `UNMAPPED`), type and source (`ALERT` or `ENRICHMENT`). Raw payload keys that the version does not declare are never copied — not into the decision, not into runbook executions, not into the timeline.
- The context carries the automation version id/number and a SHA-256 checksum. Readers verify the checksum before trusting any value.
- The decision row is immutable. The database rejects any `UPDATE` of the decision, including its context, and a `CHECK` constraint only accepts a context on LIVE, non-fallback rows for the matching version.
- Every runbook execution started for the incident copies the verified context into `RunbookExecution.responseContext`, so later audits show exactly what the run saw.

The context is **unavailable** — and every context-dependent decision fails closed — for these reasons:

| Reason             | Meaning                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `NO_LIVE_DECISION` | The service is DISABLED or SHADOW, automation is globally off, or the incident was not created by automation. |
| `FALLBACK`         | Evaluation fell back to service-default routing (corrupt/invalid version, timeout, oversized input).          |
| `NOT_CAPTURED`     | The decision predates this feature or carries no context.                                                     |
| `INTEGRITY_FAILED` | The stored context failed checksum or version validation.                                                     |

## Context trigger conditions

Binding triggers (Service → Runbooks → binding → **Conditions**) can use fields from the **Automation Context** group alongside incident and service fields. They are stored as `automation.<key>`.

- The picker lists the fields published in the service's active automation version. A warning appears when the service is not in LIVE mode, because no context will be captured.
- Operators depend on the field type: `STRING` supports equality, lists, `CONTAINS` and `STARTS_WITH`; `ENUM` and `NUMBER` support equality and lists; `BOOLEAN` supports equality. All types support `EXISTS` (value recognized), `IS_MISSING` and `IS_UNMAPPED`. There is no `NOT_EXISTS` for automation fields — use `IS_MISSING` / `IS_UNMAPPED` explicitly.
- `MISSING` and `UNMAPPED` values never satisfy a value comparison, including negative operators (`NOT_EQUALS`, `NOT_IN`).
- If context is unavailable, a trigger that references any `automation.*` field does not match, and the incident timeline records one `RUNBOOK_SKIPPED` event per binding (job retries do not duplicate it), for example `Runbook skipped: <runbook>: AUTOMATION_CONTEXT_UNAVAILABLE: NO_LIVE_DECISION`.
- If a referenced field was removed from the automation schema or changed type, the trigger is treated as configuration-invalid (`AUTOMATION_FIELD_REMOVED`, `AUTOMATION_FIELD_TYPE_CHANGED`, `AUTOMATION_OPERATOR_INVALID`) and is skipped with the same audit event instead of being reinterpreted.

AUTOMATIC executions re-evaluate the trigger inside the execution transaction with the same context loader, so evaluation and execution always see identical data.

### Monitoring incidents are opt-in

Incidents opened by monitoring alerts only evaluate bindings with **Run on monitoring incidents** enabled. The default is off for new and existing bindings, so upgrading never starts remediation on alert traffic by surprise. Manually created incidents keep their existing behavior.

## Context inputs and approved targets

- **Inputs from automation context** map a runbook input to an automation field of a compatible type (`STRING`/`ENUM` → text inputs, `NUMBER` → number, `BOOLEAN` → boolean). Secrets are never sourced from alert content. A required input whose field is unavailable, missing, unmapped or invalid blocks the automatic run (`INPUT_CONTEXT_UNRESOLVED`); an optional one keeps the configured binding value.
- **Approved targets by automation value** is a table of exact `value → Agent pool or Agent` rows chosen by an administrator, for example `cluster = prod-eu-1 → k8s-eu agent`. The alert can only select among these rows:
  - an unlisted value blocks the run (`TARGET_UNMAPPED_VALUE`); it never falls back to label matching;
  - unavailable context blocks the run (`TARGET_CONTEXT_UNAVAILABLE`), as does a missing/unmapped value (`TARGET_CONTEXT_UNRESOLVED`) or a field no longer in the schema (`TARGET_MAPPING_INVALID`);
  - the chosen target must still be approved by this binding at dispatch (`TARGET_NOT_AUTHORIZED`) and must have a healthy, capable Agent (`TARGET_NOT_ELIGIBLE`). Agents must be ONLINE with a fresh heartbeat and the step capability (for example `RUNBOOK_KUBERNETES`).
- Agent selectors can no longer read automation context. `${{ context.* }}` or `${{ automation.* }}` in an Agent selector is rejected at save time; use the approved target table instead.

The chosen target and its provenance are recorded on the execution (`targetSelection.provenance = { kind: "CONTEXT_MAPPING", contextKey, value }`) and shown in the response timeline.

## Unattended writes

AUTOMATIC executions run `READ_ONLY` steps without approval. Write steps (`IDEMPOTENT_WRITE`) wait in `WAITING_APPROVAL` unless an administrator has authorized unattended writes for the binding:

- Authorization is available only for AUTOMATIC bindings with the **PINNED** version strategy and applies to that exact pinned version. Use **Authorize vN** in the binding's unattended-writes panel. Administrators need the `automation.publish` capability in addition to service modification rights.
- Every write action must have at least one verification step (`UNATTENDED_WRITE_VERIFICATION_REQUIRED`). The panel lists each write action, its risk class and whether it has verification before you authorize.
- `NON_IDEMPOTENT` steps always require approval, even when authorized. For example, Kubernetes `rollout-restart` is classified `NON_IDEMPOTENT` and cannot be downgraded; Kubernetes `scale` is `IDEMPOTENT_WRITE`.
- Changing the pinned version, leaving the PINNED strategy or leaving AUTOMATIC mode revokes the authorization automatically. So does any change to the inputs, target, context mappings, monitoring opt-in, trigger conditions or **Resolve on verified recovery**: an administrator must re-approve before automatic writes (and automatic incident resolution) run again. **Revoke** removes it explicitly. Authorizations and revocations are audited as `runbook.binding.unattended_writes.authorized|revoked`.
- Existing per-incident budgets, blast-radius limits and responder-started executions are unchanged.

**Upgrade behavior:** the migration does not backfill any authorization. Existing AUTOMATIC bindings keep running their read-only steps, but every write step waits for responder approval until an administrator authorizes the pinned version. Review the eligibility panel for each binding before authorizing.

## Verified recovery resolution

When an execution finishes, OpsKnight compares the action's pre/post evidence with its authored verification checks and records a recovery outcome on the execution:

| Outcome          | When                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NOT_REQUESTED`  | No write action, or **Resolve incident on verified recovery** is off. A verified run then records a "Resolution recommended" event.                    |
| `PENDING`        | Execution `SUCCEEDED`, every write action verified, binding enabled with the toggle on. A durable `VERIFIED_RESOLUTION` job is queued.                 |
| `RESOLVED`       | The job resolved the open/acknowledged incident through the incident lifecycle (source `SYSTEM`, event `AUTO_RESOLVED`, resolution kind `AUTOMATION`). |
| `NOT_VERIFIED`   | A write action was not verified, or the execution did not succeed. The incident stays open and escalation continues.                                   |
| `ALREADY_CLOSED` | The incident was already resolved when verification or the job ran. Nothing changes.                                                                   |
| `BLOCKED`        | The lifecycle refused the resolution (for example required custom fields). A `RUNBOOK_SKIPPED` event explains why; escalation continues.               |

Runbook success alone never resolves an incident, and read-only runbooks never resolve. The resolution job re-checks everything in a serializable transaction and is idempotent: processing it twice resolves once. Resolving through the lifecycle cancels pending escalation (`escalationStatus = COMPLETED`, `nextEscalationAt = null`) and fences stale escalation workers.

For `NO_ESCALATION` incidents, a failed, timed-out or unverified remediation records a **Human intervention required** event because no responder is being paged.

## Paging independence

- Routing, the pinned escalation policy and the first escalation job are committed by ingestion, before any runbook job runs.
- Runbooks never pause, delay or reorder escalation. A runbook job that fails, is retried or is stuck does not roll back the incident, the decision or escalation state.
- Approval waits show "Paging is not delayed by this approval" in the timeline.
- Only a verified, opted-in recovery — or a responder — resolves the incident and therefore stops paging.

## Unified response timeline and incident context

Incident detail → **Response activity** shows one ordered timeline in five lanes: **Routing** (decision, rule, priority, policy), **Paging** (escalation steps and notifications), **Remediation** (suggestions, executions, approvals, skips), **Verification** (per-write verification) and **Recovery** (recovery outcome, acknowledge/resolve/reopen). The **Incident context** card lists captured fields with value and source. Both views work on desktop and mobile and follow existing redaction: viewers without automation read access do not see routing detail, viewers without sensitive incident access see values redacted, and viewers without runbook read access do not see remediation and verification lanes.

## Failure modes

| Signal                                                       | Cause                                                                                                           | Effect                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `RUNBOOK_SKIPPED … AUTOMATION_CONTEXT_UNAVAILABLE: <reason>` | Trigger references `automation.*` and context is unavailable.                                                   | No run or suggestion; paging continues.  |
| `RUNBOOK_SKIPPED … AUTOMATION_FIELD_* / INPUT_* / TARGET_*`  | Configuration no longer matches the schema, input or target table.                                              | No run; fix the binding.                 |
| `AUTOMATION_NOT_AUTHORIZED`                                  | Execution re-validation failed (binding changed, not PINNED, monitoring opt-in off, trigger no longer matches). | No run.                                  |
| `TRIGGER_ALREADY_HANDLED`                                    | A replayed evaluation for an incident/binding that already ran.                                                 | Treated as success; no duplicate.        |
| `AUTO_REMEDIATION_BUDGET_EXHAUSTED`                          | Per-incident automatic budget used.                                                                             | Converted to a responder suggestion.     |
| `WAITING_APPROVAL`                                           | Write step without unattended authorization, or `NON_IDEMPOTENT`.                                               | Waits for a responder; paging continues. |
| `RUNBOOK_UNVERIFIED`                                         | Verification failed or produced no evidence.                                                                    | Incident stays open.                     |

## Rollout

1. Apply migrations `20261019110000_automation_response_context` and `20261019120000_runbook_automation_integration` (both additive) and deploy the same image to every web, scheduler and worker role.
2. Put the service's automation in LIVE (see [Operator rollout](README.md#operator-rollout)) and confirm the **Incident context** card shows the expected fields on new incidents.
3. In Service → Runbooks, add `automation.<key>` trigger conditions and, where the target depends on context, fill the approved target table. Start with SUGGESTED mode to review matches.
4. Switch to AUTOMATIC + PINNED and enable **Run on monitoring incidents**. Writes still wait for approval.
5. After reviewing the eligibility panel, authorize unattended writes for the pinned version. Enable **Resolve incident on verified recovery** only for runbooks whose verification checks prove recovery.
6. Watch the Response activity timeline for `RUNBOOK_SKIPPED`, `RUNBOOK_UNVERIFIED` and approval waits. To stop remediation immediately, revoke unattended writes or disable the binding; paging is unaffected.

## Verification commands

Run against an isolated, disposable database (these suites reset it):

```bash
DATABASE_URL=postgresql://... npx vitest run -c vitest.int.config.ts --no-file-parallelism \
  tests/integration/runbook-automation-e2e.test.ts \
  tests/integration/runbook-automation-context.test.ts \
  tests/integration/runbook-automation-safety.test.ts \
  tests/integration/runbook-execution-safety.test.ts \
  tests/integration/incident-response-timeline.test.ts
npx vitest run -c vitest.unit.config.ts tests/architecture/automation-config-contract.test.ts
```

`runbook-automation-e2e.test.ts` drives real Events API ingestion through routing, paging, context-targeted Kubernetes remediation, verification and automatic resolution, and certifies paging independence, unattended-write gating, payload steering, SHADOW fail-closed behavior, context immutability, and crash/retry idempotency.
