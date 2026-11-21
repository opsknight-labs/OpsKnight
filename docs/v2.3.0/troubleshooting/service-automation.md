---
title: Troubleshoot service automation
description: Diagnose access, draft recovery, extraction, routing, candidate evidence, delivery, Runbook context, and privacy cleanup failures.
type: troubleshooting
product_area: services
audience: [administrator, operator, responder]
verification:
  level: source
  verified_at: 2026-10-30
  evidence:
    - src/lib/automation/versioning.ts
    - src/lib/automation/runtime.ts
    - src/lib/automation/access.ts
    - src/lib/automation/response-context.ts
    - src/lib/automation/privacy-cleanup.ts
    - src/lib/automation/observation-batch.ts
    - src/components/automation/workspace/useAutomationDraft.ts
    - src/lib/runbooks/automation-binding.ts
---

# Troubleshoot service automation

Start by recording the service ID, incident ID, active/candidate version IDs,
effective mode, and exact failure message. Keep source payloads and credentials
out of diagnostic tickets. Use the [production procedure](../operate/reliability/service-automation)
for global changes and the [reference](../reference/service-automation) for exact contracts.

## The workspace is read-only or unavailable

Confirm the actor is active and has automation read capability. Administrators,
Responders, and Auditors can read automation under their resource authorization;
Auditors do not gain draft editing or sensitive sample access. A Responder needs
membership in the service's owning team to edit. Publication, candidate activation,
and mode changes require administrator privilege; API scopes cannot elevate a role.
Verify the service ID and current team ownership before retrying.

## Draft changes disappeared or publishing is paused

Check whether the UI showed Saved, Unsaved, Offline, Save failed, or Conflict.
A local recovery copy depends on browser storage and is scoped to account/service.
Review both copies before choosing Keep my copy or Reload their changes; download
local work before replacing it. An API 412 means a reviewed precondition is stale.
Refetch and reconcile rather than automatically overwriting the newer draft.
A starter template replaces the rules list; it does not append to existing rules.

## A field is missing, unmapped, or absent from discovery

Inspect the actual integration type, EVENT/PROVIDER source, ordered mapping paths,
canonical type, and aliases. The first nonblank selected value is normalized;
a later mapping does not repair an earlier invalid scalar. Test the same input
with the intended integration ID and an explicit provider sample.

A missing discovery suggestion can be caused by traversal/cardinality limits,
sensitive filtering, missing signing configuration, or queued observation work.
It does not prove the explicit extraction path is invalid. Recent stored-alert
replay contains normalized event data, not the original provider payload.
Do not enable preview storage as a substitute for knowing the sender's schema.

## A rule matches in Test but production differs

Verify you tested the same snapshot as the published active version and supplied
the same classification/integration context. Test is not event ingestion and does
not certify deduplication, provider delivery, or an active mode.

Check global enablement and the stored/effective service modes. A draft does not
route. While Live, a new publication is only a candidate until activation. An
accepted queued event can retain older pointers, and an existing incident retains
its captured decision. Repeated triggers deduplicated into that incident do not
exercise the new-incident automation path. Send a fresh controlled deduplication key.

## A negative condition did not match

Missing/unmapped values do not satisfy ordinary negative comparisons. Inspect
IS_MISSING or IS_UNMAPPED explicitly. IS_SET includes Unmapped; use a recognized
value comparison when valid canonical data is required. All conditions in a rule
are ANDed. For OR, create separate rules and review their order.

## Routing or priority is unexpectedly overridden

All matching enrichment rules run in order; later writers to the same field win.
Routing stops at the first matching rule. Move an overly broad rule or catch-all
below specific rules. Check warnings about priority conflicts or shadowed rules.
Changing priority does not change urgency. Selecting no escalation suppresses
responder escalation but does not discard the incident or mute every notification.

## Publication or activation rejects a dependency

Check referenced escalation policies, valid responder targets, service default
policy safety, and destination ownership/enablement. Disabled rules are still
validated. A restored historical snapshot can reference a policy/destination
that is no longer usable. Repair the dependency or draft, validate again, and
repeat the reviewed publication/activation flow; do not bypass database guards.

## Live reactivation asks for review again

Every request selecting Live repeats mode activation checks, including recovery
from Disabled or Shadow and requests while already Live. The current active
version needs valid dependencies, and absent Shadow evidence/errors can require
explicit acknowledgement. Candidate promotion additionally uses its own readiness
policy. Prior Live usage is not a permanent waiver.

## Candidate activation is blocked or counts look inconsistent

Confirm evidence belongs to the candidate being reviewed. Review the seven-day
window, daily-bucket age, quantity floor, error/fallback rate, and pending/processing
allowance. Pending-work samples can be truncated lower bounds. Overlapping
route/priority/suppression/error counters must not be added as independent events.

Let workers drain a backlog above policy; acknowledgement does not bypass it.
Repair an invalid global policy. If the expected active/candidate ID or policy
revision changed, reload and review again. Review material differences before
acknowledging them. Discard an incorrect candidate to leave active routing alone.

## A channel notification is missing or appears duplicated

Separate route matching, durable intent creation, and provider delivery. Confirm
an enabled destination owned by the service, then inspect Slack/Teams delivery
records and worker/provider health. Retries are accounted for by the respective
pipelines, but service notifications and supplemental automation messages can be
independent intended sends. Inspect each message's origin before concluding a
single action delivered twice. See [Notification delivery](./notifications/not-delivered).

## Runbook conditions cannot use expected context

Confirm the incident has an intact successful Live decision. No Live decision,
fallback, missing captured context, and checksum failure make response context
unavailable. Historical incidents are not rebuilt from the current draft. A field
removed from the captured schema or a type-incompatible condition is invalid.
Runbook EXISTS means Recognized, unlike automation IS_SET. Review the binding's
own approvals, inputs, target mappings, and unattended-write authorization.

## Preview cleanup is failed or observations stopped changing

Keep preview storage disabled before retrying failed cleanup as an administrator.
Check cleanup status and worker health until COMPLETE; SUPERSEDED indicates a
later opt-in, not proof of physical removal. Preview hiding precedes physical
cleanup. Observation cardinality bounds can stop admitting new identities while
existing counts continue; retention is asynchronous. Diagnose worker lag, privacy
filtering, and bounds before changing a working routing configuration.

## Confirm recovery

After correcting the cause, send one controlled new incident for each affected
route and one missing/unmapped case. Verify effective mode, pinned version, final
priority, responder outcome, intended provider delivery, and Runbook eligibility
where applicable. Confirm backlog/cleanup progress separately. Preserve the
reviewed change and evidence in the audit trail.
