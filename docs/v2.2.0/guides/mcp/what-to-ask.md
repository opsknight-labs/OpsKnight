---
title: What to ask an assistant
order: 2
description: Example requests by role, the built-in prompt or tool each uses and the permission it needs, plus three annotated sessions.
type: how-to
product_area: mcp
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-11-05
  evidence:
    - src/lib/mcp/catalog/capabilities.ts
    - src/lib/mcp/core/execution.ts
    - src/lib/mcp/protocol/server.ts
    - src/lib/mcp/approvals/operation.ts
---

# What to ask an assistant

Once your assistant is connected ([setup](self-hosted-setup.md)), ask in plain language. The assistant picks a tool; you never type tool names. Each request below names the built-in prompt or tool it maps to and the permission (scope) the connection needs. See the [permissions reference](../../reference/mcp/permissions.md) for what each permission unlocks and which roles can use it, and the [tool reference](../../reference/mcp/tools.md) for every tool.

The assistant can only do what you can do in OpsKnight, and only within what you approved when you connected it.

## Example requests

### On call

| Ask                                                                           | Uses                                                  | Needs                              |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| "Who am I in OpsKnight, and what can you do for me?"                          | `whoami`                                              | nothing extra                      |
| "What's open and assigned to me right now?"                                   | `incident_search` with `assigneeId: "me"`             | `incidents:read`                   |
| "Investigate incident #A1B2C: what happened, what changed, anything related?" | `investigate_incident` prompt, `incident_get_context` | `incidents:read`                   |
| "Acknowledge it and add a note that I'm looking at the database."             | `incident_acknowledge`, `incident_add_note`           | `incidents:write`, changes allowed |
| "Who is on call for payments, and who's next?"                                | `oncall_lookup`                                       | `schedules:read`                   |
| "When am I on call over the next two weeks, and who takes over from me?"      | `oncall_my_shifts`                                    | `schedules:read`                   |

### Incident commander

| Ask                                                                               | Uses                                                            | Needs                                                      |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| "Why did this page go to the database team, and who gets it next?"                | `explain_escalation` prompt, `escalation_explain`               | `escalation-policies:read`                                 |
| "Is the checkout service healthy, and what's its recent incident history?"        | `service_get_health`                                            | `services:read`                                            |
| "Which runbook fits this incident? Show me what it would do, without running it." | `preview_remediation` prompt, `runbook_find`, `runbook_preview` | `runbooks:read`                                            |
| "Prepare that runbook run for approval."                                          | `runbook_prepare_execution`                                     | `runbooks:execute` and the reads it lists, changes allowed |

### Team lead

| Ask                                                              | Uses                                                  | Needs                                |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| "Summarize last night's shift for the platform schedule."        | `summarize_shift` prompt                              | `schedules:read`, `incidents:read`   |
| "Draft the postmortem for yesterday's outage from the timeline." | `prepare_postmortem` prompt, `postmortem_get_context` | `postmortems:read`, `incidents:read` |
| "How did our response times look this month?"                    | `report_get_summary`                                  | `reports:read`                       |
| "Who is on the platform team, and what are their roles?"         | `read_operation` (listUsers, getUser)                 | `users:read`, `teams:read`           |

### Administrator

| Ask                                                                                   | Uses                                                                                               | Needs                                            |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| "Review the automation rule on the billing service: what would it do to a new alert?" | `review_automation_rule` prompt, `automation_get_effective`, `read_operation` (simulateAutomation) | `automation:read`                                |
| "Find the operation that changes a service's support hours and describe it."          | `search_capabilities`, `describe_operation`                                                        | none to search; the operation's own scope to run |
| "Change the support hours on the billing service to 08:00 to 18:00."                  | `operation_prepare`, then your approval                                                            | `services:write`, changes allowed                |
| "List every integration on the checkout service."                                     | `read_operation`                                                                                   | `integrations:read`                              |
| "Is the checkout webhook integration failing deliveries?"                             | `read_operation` (getIntegrationDiagnostics)                                                       | `integrations:read`                              |
| "Who changed the payments escalation policy last week?"                               | `read_operation` (listAuditLogs), sensitive reads on                                               | `audit:read` (Administrators and Auditors)       |

If a request needs a permission the connection was not granted, the assistant gets `MCP_SCOPE_NOT_GRANTED`: reconnect and approve that permission. If your role can never do it, it gets `MCP_OPERATION_FORBIDDEN`, and reconnecting will not help.

## "Assigned to me"

Assistants do not know who you are until they ask. Incident lists accept `assigneeId: "me"`, which the server resolves to you. For anything else, assistants call `whoami` first: it returns your user id, display name, role, teams, effective permissions, whether changes and sensitive reads are on, and the enabled tools. It never returns your email address.

## Annotated sessions

These are written as text, not screenshots, so they can be checked against the server. Tool results are shortened.

### A read-only investigation

```text
You:       What's going on with incident #A1B2C?
Assistant: → incident_get_context { "id": "<incident id>" }
           ← incident, its last timeline events and related incidents on the same service
Assistant: It's a P1 on checkout, triggered 12 minutes ago, unacknowledged. Two similar
           incidents last week were resolved by restarting the payment worker.
```

Nothing changed. `incident_get_context` is one read of the incident, its timeline and related incidents, with the same visibility you have in OpsKnight. Incident text is returned as untrusted data, so instructions inside an alert are not followed.

### Acknowledge and add a note

```text
You:       Acknowledge it and note that I'm on it.
Assistant: → incident_acknowledge { "path": { "id": "<incident id>" },
                                     "idempotencyKey": "ack-<incident id>-1" }
           ← acknowledged
Assistant: → incident_add_note { "path": { "id": "<incident id>" },
                                  "body": { "content": "On it: checking the payment worker." },
                                  "idempotencyKey": "note-<incident id>-1" }
           ← note added
```

Routine changes run directly when an administrator allows changes. The `idempotencyKey` makes a retry safe: if the response is lost and the assistant repeats the same call with the same key, OpsKnight applies it once.

### A configuration change with approval

```text
You:       Set the billing service's support hours to 08:00 to 18:00.
Assistant: → describe_operation { "operationId": "updateServiceSupportHours" }
Assistant: → operation_prepare { "operationId": "updateServiceSupportHours",
                                  "args": { "path": { "id": "<service id>" }, "body": { … },
                                            "ifMatch": "\"3\"" },
                                  "idempotencyKey": "support-hours-billing-0001" }
           ← { "approvalId": "…", "status": "PENDING", "reviewUrl": "https://ops…/approvals/…" }
Assistant: This needs approval. Open the review link to approve it.
           (You open reviewUrl in OpsKnight, check the frozen change and approve.)
Assistant: → operation_get_approval { "approvalId": "…" }
           ← { "status": "APPROVED", "commitDeadline": "…", "next": "operation_commit_approved" }
Assistant: → operation_commit_approved { "approvalId": "…" }
           ← committed
```

Configuration changes never run directly. `operation_prepare` freezes the exact change; a person approves it on the OpsKnight review page (an administrator may approve their own request after an explicit confirmation); the assistant then commits that frozen change within the commit window. The assistant can never approve. While a request is pending, `operation_get_approval` suggests when to check again (`pollAfterSeconds`).
