---
title: Service bindings and triggers
description: Configure automation rules, automatic activation, incident triggers, concurrent edits, and rule lifecycle.
type: how-to
product_area: runbooks
audience: [administrator]
verification:
  level: source
  verified_at: 2026-10-15
  evidence:
    [
      src/components/service/ServiceRunbooks.tsx,
      src/lib/runbooks/triggers.ts,
      src/lib/runbooks/orchestrator.ts,
    ]
---

# Service bindings and triggers

A **service automation rule** connects a published Runbook to a specific
service with concrete input values, an execution target, a binding mode, and
optionally an incident-created trigger.

## Rule configuration fields

| Field                       | Type    | Description                                             |
| --------------------------- | ------- | ------------------------------------------------------- |
| `name`                      | String  | Optional display name for the rule                      |
| `mode`                      | Enum    | `MANUAL`, `SUGGESTED`, or `AUTOMATIC`                   |
| `enabled`                   | Boolean | Toggle without deleting                                 |
| `versionStrategy`           | Enum    | `PINNED` or `LATEST_PUBLISHED`                          |
| `runbookVersionId`          | String? | Set when strategy = PINNED                              |
| `defaultAgentId`            | String? | Default Agent for executions                            |
| `defaultAgentPoolId`        | String? | Default pool for executions                             |
| `agentSelector`             | JSON    | Dynamic Agent label selector                            |
| `inputValues`               | JSON    | Pre-filled input values                                 |
| `resolveOnVerifiedRecovery` | Boolean | Auto-resolve incident on verified recovery              |
| `runOnMonitoringIncidents`  | Boolean | Opt-in for monitoring-sourced incidents                 |
| `contextInputMappings`      | JSON    | Maps `[{inputKey, contextKey}]` from automation context |
| `contextTargetMappings`     | JSON    | Routes to specific Agent/pool by context value          |
| `configurationRevision`     | Int     | Optimistic locking counter                              |

## Trigger configuration

### Supported events

Only **Incident created** (`INCIDENT_CREATED`) is wired to runtime evaluation
in v2.1. Other enum values (`INCIDENT_UPDATED`, `URGENCY_CHANGED`,
`STATUS_CHANGED`, `ALERT_RECEIVED`, `MANUAL`, `API`, `CHATOPS`, `SCHEDULED`)
are compatibility identifiers and cannot be configured through the supported
trigger schema.

### Trigger conditions

Each trigger supports up to **20 conditions** with `AND` or `OR` logic:

| Operator      | Valid for               | Description                   |
| ------------- | ----------------------- | ----------------------------- |
| `EQUALS`      | STRING, NUMBER, BOOLEAN | Exact match                   |
| `NOT_EQUALS`  | STRING, NUMBER, BOOLEAN | Inverse match                 |
| `CONTAINS`    | STRING                  | Substring match               |
| `STARTS_WITH` | STRING                  | Prefix match                  |
| `IN`          | STRING, NUMBER, BOOLEAN | One of a list                 |
| `NOT_IN`      | STRING, NUMBER, BOOLEAN | None of a list                |
| `EXISTS`      | All                     | Field is present and non-null |
| `NOT_EXISTS`  | All                     | Field is absent or null       |
| `IS_MISSING`  | `automation.*` only     | Context field missing         |
| `IS_UNMAPPED` | `automation.*` only     | Context field unmapped        |

Trigger conditions allow only incident/service fields, never inputs. Stored
triggers with invalid paths are suppressed before matching — a misspelled
field cannot activate automation.

### Trigger evaluation

- Incident-trigger evaluation reads rules in **ordered batches of at most
  100**, instead of loading the full inventory into memory.
- Every enabled rule is evaluated; duplicate event delivery retains existing
  fingerprint fences.
- Total processing time grows with rule count and matching actions.
- Changes affect future matching events; they do not retroactively regenerate
  old suggestions.
- Each edit increments the condition revision and records previous/new
  conditions in the audit.

## Automatic activation

Automatic rules always save **paused**, including configuration changes to an
active rule. To activate:

1. Open **Rule evidence**.
2. Validate configuration.
3. Request fresh Agent policy checks.
4. Use **Activate Automatic rule**.

Requirements:

- Each selected Agent must have current successful policy evidence for the
  frozen version and inputs.
- A trigger with no conditions requires explicit confirmation that it may
  match every new incident for the service.
- Activation does not execute a workflow or bypass step approval, frozen-plan
  preview, target permission, or unknown-outcome fences.

### Automatic target support

| Target type                    | Automatic support | Notes                                |
| ------------------------------ | ----------------- | ------------------------------------ |
| Specific Agent (static labels) | ✅                | Agent must return fresh policy check |
| Fixed pool (no label selector) | ✅                | All eligible Agents must pass        |
| Incident-dependent selector    | ❌                | Use Suggested mode                   |
| Selector-only fleet targeting  | ❌                | Use Suggested mode                   |

### Policy certification scale

Automatic policy certification supports **1–100 eligible online Agents per
target**, using durable per-Agent requests inserted in batches of 25.
Activation requires fresh accepted evidence for every currently eligible Agent.
Membership, configuration, or policy changes and expiry invalidate incomplete
evidence. Larger targets remain blocked.

## Concurrent rule changes and pausing

Configuration and trigger forms carry the rule revision displayed when the
form opened. If another administrator saves, pauses, detaches, or activates
the rule first, a stale save is rejected. Reload the page, review the current
configuration, and apply your changes again.

### Pause semantics

| Operation                        | Behavior                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| **Pause obtains lock first**     | A waiting start rechecks the disabled rule and creates no execution    |
| **Execution obtains lock first** | That execution may commit before Pause completes                       |
| **After Pause**                  | Prevents subsequent starts; does not cancel already-created executions |
| **Cancel**                       | Must be done separately for running executions                         |

### Configuration revision tracking

Rule configuration saves increment a monotonic configuration revision.
Incident evaluation verifies revision, mode, selected publication, and trigger
revision under the workflow lock before recording a suggestion. A change to
mode, version, inputs, or target invalidates a match read before the edit
committed.

## Rule lifecycle

| State        | Description                                                            |
| ------------ | ---------------------------------------------------------------------- |
| **Active**   | Rule is enabled and can dispatch (if conditions met)                   |
| **Paused**   | Rule is disabled; no new triggers fire                                 |
| **Detached** | Archived — disappears from active list; evidence and history preserved |

### Detachment behavior

- Historical suggestions retain their rule and trigger identity.
- Pending suggestions cannot start after detachment.
- Archived rules cannot be edited or reactivated.
- Evidence URL, original configuration, suggestions, and execution
  associations remain available.
- Use **Rule history → Archived rules** on the service Runbooks tab to search
  detached rules by rule or workflow name.

## Service rule pages

Service automation lists show **20 rules per page**:

- **Next rules** uses a stable creation-time/ID cursor.
- **First rules** returns to the newest page.
- Readiness checks and displayed counts apply to the visible page.
- Workflow and Agent/pool searches keep inventories bounded.

## Context input and target mappings

### Context input mappings

Map Runbook inputs from incident automation context at trigger time:

```json
[
  { "inputKey": "service_name", "contextKey": "service.name" },
  { "inputKey": "host", "contextKey": "incident.labels.host" }
]
```

### Context target mappings

Route execution to a specific Agent/pool based on incident context:

```json
{
  "contextKey": "incident.labels.env",
  "entries": [
    { "value": "production", "agentId": "agent-prod-01" },
    { "value": "staging", "agentPoolId": "pool-staging" }
  ]
}
```

## Readiness states

| State                 | Meaning                                 |
| --------------------- | --------------------------------------- |
| `PAUSED`              | Rule is disabled                        |
| `BLOCKED`             | Missing requirements prevent activation |
| `CHECKS_REQUIRED`     | Agent policy checks needed              |
| `CONFIGURATION_VALID` | Ready for activation                    |
| `UNKNOWN`             | Cannot determine status                 |

Online/capable Agents alone cannot produce a target-permission guarantee.
Agent policy checks are signed, scoped, one-time results with an exact frozen
action list.

## See also

- [Bind and respond](./respond) for incident-side execution workflows.
- [Author and publish](./author) for creating the workflows rules reference.
- [Permissions](./permissions) for required capabilities.
