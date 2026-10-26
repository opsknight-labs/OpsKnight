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
- Responders executing steps need `runbook.execute` and `runbook.approve` permissions.

## Attach to a service

1. Open the service's **Runbooks** tab and choose **Attach** for the workflow.
2. Select Manual, Suggested, or Automatic mode. Begin with Manual.
3. Select latest-published or pinned version strategy. Automatic mode requires
   a pinned version; review the chosen version before enabling it.
4. Select the execution target and supply typed input values.
5. Attach and verify the binding summary: mode, version, target, inputs, and trigger.

Choose a specific Agent for machine-specific writes. Multi-member `LOCAL_HOSTS`
write targets are disabled in the UI and rejected by the backend. Use
`SHARED_TARGET` only when all members can operate the same target.

## Configure an incident-created trigger

Open **Configure** on the attached workflow. Set the binding to Suggested or
Automatic if it should react to incident creation. In the trigger section,
select **Incident created**, choose **Match all** or **Match any**, and enter
conditions such as **Incident urgency Equals HIGH**. Save the trigger and check the success message and saved summary. Binding and
trigger saves use configuration revisions: if another administrator changes
the rule while your form is open, reload the current configuration, reconcile
your edits and save again. Do not repeatedly submit an outdated form.

Changes affect future matching events; they do not retroactively regenerate
old suggestions. Trigger evaluation rechecks the rule and trigger revisions
under its transaction locks before persisting a suggestion, so an event already
being evaluated cannot create a suggestion from superseded conditions.
In Suggested mode, check a newly created matching incident
for a suggestion. An existing suggestion keeps its frozen version, resolved
inputs, and target even if its service binding is later edited.

## Service rule checks

In **Service → Runbooks**, create independent rules from published workflows. Manual mode never arms incident triggers. Suggested/Automatic rules require an active incident-created trigger to be armed; changing a trigger affects future incidents only. Dynamic label selectors remain explicit targets. Configured mode counts and historical execution counts do not certify operational success. Inventory outages preserve loaded rules and explain which dependencies are unavailable.

Use **Rule evidence** for configuration, target, immutable version, execution history, Agent policy evidence and audit links. The checks have separate meanings:

- **Validate configuration · No execution** checks the prospective configuration even while paused, without enabling it.
- **Check Agent policy · No execution** sends a signed request to 1–100 matching online Agents in durable batches of 25 and evaluates their local allowlists without running commands. Evidence is valid only for the same version, resolved configuration, current target and policy hash, for five minutes. It does not prove platform permissions or reachability.
- **Preview read-only test** runs the complete workflow only after preview confirmation, and rejects any workflow containing writes. Publish a separate diagnostic workflow when a recovery workflow also writes.
- **Run now · Preview plan** uses a single-use preview and explicit write confirmation. Permissions, approvals and Agent policy remain enforced at execution.

New/duplicate rules default to paused. Pause stops future trigger dispatch; use execution cancellation separately for work already running. Selecting Automatic asks you to confirm the exact published version and pins it.

## Start and approve

Open the incident's **Runbooks** tab and select **Preview execution** on a
suggestion or available workflow. Review the immutable version/checksum,
resolved target, redacted inputs, ordered actions, risk and approval gates.
Preview creates no execution or queued work. It reports current Agent capability
and secret-grant checks; local policy, confidential transport, network access and
platform permissions remain dispatch checks.

For writes, confirm that you reviewed the target and authorize the plan, then
select **Execute this plan**. Execution resolves the plan again in its transaction
and rejects a changed version, target, inputs, action plan or incident context
(title, description, status, urgency, priority, tags and service context). Each
preview issues a five-minute, single-use authorization bound to your account,
incident, service binding and suggestion. Another responder or incident cannot
reuse it. The preview marks expiry and disables Execute until you preview again.
Preview issuance and consumption are recorded in the audit trail,
without storing the bearer token. Temporary authorization records are purged
in bounded reconciliation batches 30 days after expiry; audit events retain
the responder, scope, digest and execution link. Conditions continue to evaluate live incident
context after execution starts. Preview again after
a stale-plan or readiness error. A successful preview is not a dry run or a
successful action. To test real actions, use an explicitly authorized test service
and Agent; preview itself does not provide an execution sandbox.

Read the ordered execution timeline. When a step waits for approval,
inspect its action, resolved parameters, risk, target Agent/pool, version
checksum, and timeout. Choose **Approve exact plan** and confirm only if that
specific action and target are appropriate.

Approval does not override Agent policy or platform permissions. A changed
plan is not authorized by a prior approval. Watch subsequent step progress and
verification output; use artifact download links when available.

## Execute through the v2 API

`POST /api/v2/runbooks/{id}/execute` uses saved rule inputs when an explicit
binding is selected or a service/incident resolves to a binding. Omit
`parameters` or send `{}` for these executions. A non-empty `parameters` object
returns HTTP 400 with `RUNBOOK_DEFINITION_INVALID`; values are never silently
ignored or substituted for the reviewed rule configuration. To change a bound
execution, edit the rule, validate it and preview the updated plan.

An unbound execution accepts `parameters` validated against the published
version's input definitions. Supply JSON numbers and booleans with their actual
types. Review preview/approval requirements and the idempotency contract in the
[v2 API reference](../../reference/api/v2) before integrating an external caller.

## Cancellation and uncertain outcomes

Use **Cancel execution** and confirm to request cancellation. Reconciliation
handles the request; it is not a rollback and does not prove an in-flight write
was stopped before executing. For **UNKNOWN** steps, independently inspect the
target and record findings before considering another run.

Use **Runbooks → Executions** for recent execution history and
**Runbooks → Health** for queue and safety signals. See
[troubleshooting](../../troubleshooting/runbooks/) for waiting or uncertain executions.

Suggestions from detached rules remain visible as historical evidence and show **Rule detached**. Preview and execution are disabled; responders with execution permission can still dismiss them. Paused rules likewise cannot start a suggestion until reactivated.

Administrators can set **Execution artifact retention** in Runbooks → Agents → Security. The 1–3650 day policy requires acknowledgement because background maintenance permanently removes expired artifact contents in bounded batches. Execution records remain, but deleted output cannot be restored. Export evidence before shortening the policy. Until an administrator saves an override, `RUNBOOK_ARTIFACT_RETENTION_DAYS` remains the fallback.
