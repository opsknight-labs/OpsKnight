---
title: Service automation
description: Understand alert context, enrichment, routing, Shadow evaluation, and immutable automation versions.
type: concept
product_area: services
audience: [administrator, responder, operator]
verification:
  level: source
  verified_at: 2026-10-28
  evidence:
    - src/lib/events.ts
    - src/lib/automation/runtime.ts
    - src/lib/automation/evaluator/index.ts
    - src/lib/automation/versioning.ts
    - src/lib/automation/settings-command.ts
    - tests/integration/automation-certification.test.ts
---

# Service automation

Service automation turns incoming alert data into consistent incident context,
priority, tags, and responder routing. Configure it in a service's **Automation**
workspace. Use it to normalize provider-specific environment labels, raise the
priority of production alerts, or select a different escalation policy for a
particular customer or account.

Start with [Configure and roll out service automation](../guides/services/service-automation).
Use the [reference](../reference/service-automation) for exact operators, limits,
and API behavior.

## Where it runs

For a new incident created through the integration event pipeline:

1. OpsKnight identifies the service and integration and handles event deduplication.
2. Incident classification supplies the base priority and urgency.
3. Automation extracts configured context from the normalized event or provider payload.
4. Enrichment rules run in order, followed by routing rules.
5. In Live mode, the final priority is used when capturing the new incident's SLA contract.
6. The incident, automation decision, and queued downstream work are persisted
   together in the ingestion transaction.

A repeated trigger deduplicated into an existing incident returns before this
new-incident automation evaluation. A new publication does not retroactively
reroute existing incidents or rewrite their captured SLA targets. Do not use
repeated alerts with the same active deduplication key to test a new version.

Accepted ingestion work can carry its automation mode and version pointers from
acceptance. Publishing later does not silently replace that queued decision.
The global emergency switch is checked again when processing enabled backlog.

## Modes and the global switch

- **Disabled** (`DISABLED`): no service automation evaluation; ordinary incident
  classification and service routing continue.
- **Shadow** (`SHADOW`): evaluate the published configuration and record how its
  result differs from ordinary routing and priority. Proposed changes and
  supplemental notifications are not applied.
- **Live** (`LIVE`): apply the active version's enrichment and responder route.
  A published candidate, if present, is evaluated separately in Shadow against
  the actual Live result.

An administrator must enable automation globally before a service can enter
Shadow or Live. Draft editing and publication remain available while globally
disabled. Saving global OFF resets all service modes to Disabled. Re-enabling
the global switch does not reactivate those services automatically.

## Context is a typed contract

Built-in fields are `priority`, `urgency`, `severity`, `integration`, and `source`.
Custom fields have a stable identity, key, label, type, extraction mappings, and
optional aliases. Supported types are text, canonical choice, number, and boolean.

For example, an `environment` choice field can map incoming `prod` and `prd` to
`production`, letting one rule work across monitoring providers. Choose the
correct extraction root: **EVENT** means the normalized Events API event;
**PROVIDER** means the original provider payload.

Each field has one of three states:

- **Recognized**: the extracted value is valid for the configured type and choices.
- **Missing**: no usable value was extracted.
- **Unmapped**: a scalar arrived but could not be interpreted as a configured value.

Missing and unmapped values must not accidentally match a broad negative rule.
For example, `environment != production` is unknown for a missing environment,
so it does not suppress paging. Add explicit missing/unmapped rules if your
operating policy requires handling those states.

## Enrichment and routing have different order rules

All matching **enrichment** rules run in configured order. They can set priority,
write declared custom context, and add tags. Later rules see earlier context
writes; later writes to the same field win. Tags are deduplicated.

**Routing** evaluates the enriched context. The first matching routing rule wins,
and evaluation stops. Each routing rule chooses exactly one responder route:

- Use the service default escalation policy.
- Use a selected escalation policy.
- Use no escalation.

A matching routing rule can additionally notify configured Slack or Microsoft
Teams destinations. If no routing rule matches, the service default route wins.
An unconditional routing rule matches everything, so put it last.

**No escalation suppresses responder escalation, not incident creation or every
notification path.** Service notifications, supplemental channel notifications,
and other configured downstream integrations have separate behavior.

## Drafts, versions, and candidates

A draft is editable and has a revision for conflict detection. Saving it does not
change production behavior. Publishing validates the configuration and its
policy/destination dependencies and creates an immutable numbered version.

Publishing while Disabled or Shadow makes that version active without changing
the service mode. Publishing while Live stages a **candidate**; the current active
version keeps routing. Candidate activation promotes it atomically and clears the
candidate pointer. Discarding a candidate leaves the active version unchanged.

Restoring a historical version copies it into the draft. It does not publish,
activate, discard a candidate, or switch modes. Review and publish the restored
draft through the normal workflow.

## Relationship to Runbooks

Service automation controls alert interpretation and responder routing. A Runbook
service binding controls workflow execution and its own eligibility, approvals,
and unattended-write authorization. A successful Live evaluation can provide
captured context for downstream Runbook conditions; Shadow and failed/fallback
results do not provide that executable response context.

Configuring a routing rule does not by itself authorize a remediation workflow.
See [Runbook incident response](../guides/runbooks/respond).

## Access and diagnostics

Reading, editing, and publishing are separate permissions. Administrators can
edit and publish; responders can edit services owned by their teams; authorized
readers can inspect configuration. Publication and mode changes require the
publish capability. API callers also need the corresponding automation scopes.

Decisions and traces explain the version, rule, final priority, route, and
fallback reason. Incident diagnostic access follows incident visibility checks.
Discovery is not a raw payload archive: stored value previews are off by default,
sensitive paths and values are excluded, and traces/discovery observations follow
the configured retention policy.

Continue with the [rollout guide](../guides/services/service-automation) and
[exact behavior and troubleshooting](../reference/service-automation).
