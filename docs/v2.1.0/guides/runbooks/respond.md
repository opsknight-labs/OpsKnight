---
title: Bind Runbooks and respond to incidents
description: Select service-specific inputs and targets, configure incident triggers, approve exact plans, and request cancellation.
type: how-to
product_area: runbooks
audience: [administrator, responder]
verification:
  level: test
  verified_at: 2026-10-04
  evidence: [src/components/service/ServiceRunbooks.tsx, src/components/incident/IncidentRunbooks.tsx, tests/e2e/runbooks-ui.spec.ts, src/lib/runbooks/triggers.ts]
---

# Bind Runbooks and respond to incidents

Publish a [Runbook](./author) first. You need service modification access and
`runbook.manage` to configure bindings, `runbook.execute` to start/cancel, and
`runbook.approve` to approve steps. Incident access is checked separately.

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
conditions such as **Incident urgency Equals HIGH**. Save the trigger.

Changes affect future matching events; they do not retroactively regenerate
old suggestions. In Suggested mode, check a newly created matching incident
for a suggestion. An existing suggestion keeps its frozen version, resolved
inputs, and target even if its service binding is later edited.

## Start and approve

Open the incident's **Runbooks** tab. Start a suggestion or an available manual
binding. Read the ordered execution timeline. When a step waits for approval,
inspect its action, resolved parameters, risk, target Agent/pool, version
checksum, and timeout. Choose **Approve exact plan** and confirm only if that
specific action and target are appropriate.

Approval does not override Agent policy or platform permissions. A changed
plan is not authorized by a prior approval. Watch subsequent step progress and
verification output; use artifact download links when available.

## Cancellation and uncertain outcomes

Use **Cancel execution** and confirm to request cancellation. Reconciliation
handles the request; it is not a rollback and does not prove an in-flight write
was stopped before executing. For **UNKNOWN** steps, independently inspect the
target and record findings before considering another run.

Use **Runbooks → Executions** for recent execution history and
**Runbooks → Health** for queue and safety signals. See
[troubleshooting](../../troubleshooting/runbooks/) for waiting or uncertain executions.
