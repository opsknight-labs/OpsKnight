---
title: Bind Runbooks and respond to incidents
description: Select service-specific inputs and targets, configure incident triggers, approve exact plans, and request cancellation.
type: how-to
product_area: runbooks
audience: [administrator, responder]
verification:
  level: test
  verified_at: 2026-10-15
  evidence:
    [
      src/components/service/ServiceRunbooks.tsx,
      src/components/incident/IncidentRunbooks.tsx,
      tests/e2e/runbooks-ui.spec.ts,
      src/lib/runbooks/triggers.ts,
    ]
---

# Bind Runbooks and respond to incidents

Publish a [Runbook](./author) first. You need service modification access and
`runbook.manage` to configure bindings, `runbook.execute` to start/cancel, and
`runbook.approve` to approve steps. Incident access is checked separately.

## Prerequisites

- At least one published Runbook workflow available in the library.
- Appropriate team or service modification permissions (`runbook.manage`).
- Responders executing steps need `runbook.execute` and `runbook.approve`
  permissions.

## Attach to a service

1. Open the service's **Runbooks** tab and choose **Attach** for the workflow.
2. Select the binding mode:
   - **Manual** — responder starts from an incident. Begin here.
   - **Suggested** — trigger produces a suggestion; responder decides.
   - **Automatic** — trigger starts the workflow (requires pinned version).
3. Select the version strategy:
   - **Latest-published** — follows future publications.
   - **Pinned** — retains the chosen version. Required for Automatic mode.
4. Select the execution target and supply typed input values.
5. Attach and verify the binding summary: mode, version, target, inputs, and
   trigger.

Choose a specific Agent for machine-specific writes. Multi-member `LOCAL_HOSTS`
write targets are disabled in the UI and rejected by the backend. Use
`SHARED_TARGET` only when all members can operate the same target.

## Configure an incident-created trigger

Open **Configure** on the attached workflow:

1. Set the binding to **Suggested** or **Automatic**.
2. In the trigger section, select **Incident created**.
3. Choose **Match all** (AND) or **Match any** (OR).
4. Enter conditions such as **Incident urgency Equals HIGH**.
5. Save the trigger and check the success message and saved summary.

Binding and trigger saves use configuration revisions — if another
administrator changes the rule while your form is open, reload and reconcile
before saving. Changes affect future matching events; they do not retroactively
regenerate old suggestions.

For complete trigger configuration details, including all operators and
automatic activation, see [Service bindings and triggers](./service-bindings).

## Service rule checks

In **Service → Runbooks**, create independent rules from published workflows.
Each rule type offers different verification:

| Check                      | What it does                                                              | Executes actions?       |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------- |
| **Validate configuration** | Checks prospective configuration even while paused                        | No                      |
| **Check Agent policy**     | Sends signed request to 1–100 matching Agents; evaluates local allowlists | No                      |
| **Preview read-only test** | Runs the complete workflow after confirmation                             | Only read-only steps    |
| **Run now → Preview plan** | Uses single-use preview and explicit write confirmation                   | After explicit approval |

Key behaviors:

- New/duplicate rules default to **paused**.
- Pause stops future trigger dispatch; use execution cancellation separately
  for running work.
- Selecting Automatic asks you to confirm the exact published version and pins
  it.

## Preview and approve

### Preview execution

Open the incident's **Runbooks** tab and select **Preview execution** on a
suggestion or available workflow:

1. Review the immutable version/checksum, resolved target, redacted inputs,
   ordered actions, risk, and approval gates.
2. Preview reports current Agent capability and secret-grant checks.
3. Preview creates no execution or queued work.

Preview issues a **five-minute, single-use authorization** bound to your
account, incident, service binding, and suggestion. It cannot be reused by
another responder or incident. The preview marks expiry and disables Execute
until you preview again.

Preview issuance and consumption are recorded in the audit trail without
storing the bearer token. Temporary authorization records are purged 30 days
after expiry; audit events retain the responder, scope, digest, and execution
link.

### Start execution

For writes, confirm that you reviewed the target and authorize the plan, then
select **Execute this plan**:

- Execution resolves the plan again in its transaction.
- It rejects a changed version, target, inputs, action plan, or incident
  context (title, description, status, urgency, priority, tags, service
  context).
- Conditions continue to evaluate live incident context after execution
  starts.

A successful preview is not a dry run or a successful action. To test real
actions, use an explicitly authorized test service and Agent.

### Approve exact plan

When a step waits for approval:

1. Inspect its action, resolved parameters, risk, target Agent/pool, version
   checksum, and timeout.
2. Choose **Approve exact plan** and confirm.
3. Approval does **not** override Agent policy or platform permissions.
4. A changed plan is not authorized by a prior approval.

Watch subsequent step progress and verification output; use artifact download
links when available.

## Execute through the v2 API

`POST /api/v2/runbooks/{id}/execute` uses saved rule inputs when a binding is
selected or resolved:

- **Bound execution** — omit `parameters` or send `{}`. A non-empty
  `parameters` object returns HTTP 400 with `RUNBOOK_DEFINITION_INVALID`.
- **Unbound execution** — accepts `parameters` validated against the
  published version's input definitions. Supply JSON numbers and booleans
  with their actual types.

Review preview/approval requirements and the idempotency contract in the
[v2 API reference](../../reference/api/v2) before integrating.

## Cancellation and uncertain outcomes

### Cancel execution

Use **Cancel execution** and confirm to request cancellation:

- Reconciliation handles the request.
- Cancellation is **not a rollback** and does not prove an in-flight write was
  stopped before executing.
- Cancel is a request, not an instant stop — the step may complete before the
  cancellation is processed.

### UNKNOWN outcomes

For **UNKNOWN** steps:

1. **Independently inspect** the target.
2. Record findings.
3. Only then consider another run.

An uncertain write may have already executed. Do not assume it failed.
Preserve logs and durable Agent state, including identity and spool.

## Execution timeline and evidence

The execution detail page shows:

| Field                    | Description                            |
| ------------------------ | -------------------------------------- |
| Step/attempt status      | Current state of each step and attempt |
| Queue time               | Time spent waiting for dispatch        |
| Claim time               | When an Agent claimed the step         |
| Start/completion         | Execution timestamps                   |
| Claimed Agent            | Which Agent executed the step          |
| Target                   | Resolved execution target              |
| Lease expiry             | When the Agent's lease expires         |
| Approval identity/digest | Who approved and the plan hash         |
| Bounded output           | Sanitized step output                  |
| Artifacts                | Downloadable output files              |

## Suggestions and detached rules

- Suggestions from detached rules remain visible as historical evidence with
  **Rule detached** label.
- Preview and execution are disabled for detached suggestions.
- Responders with execution permission can still dismiss them.
- Paused rules cannot start suggestions until reactivated.
- Existing suggestions keep their frozen version, resolved inputs, and target
  even if the service binding is later edited.

## Use navigation

- **Runbooks → Executions** for recent execution history.
- **Runbooks → Health** for queue and safety signals.
- See [troubleshooting](../../troubleshooting/runbooks/) for waiting or
  uncertain executions.
