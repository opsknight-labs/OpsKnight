---
title: Runbook reference
description: Supported step and input types, risk classes, permissions, and authoring limits.
type: reference
product_area: runbooks
audience: [administrator, operator, developer]
verification:
  level: source
  verified_at: 2026-10-04
  evidence: [src/lib/runbooks/types.ts, src/lib/runbooks/definition.ts, src/lib/runbooks/schemas.ts, src/lib/authorization.ts]
---

# Runbook reference

## Step types

The supported types are `MANUAL`, `APPROVAL`, `CONDITION`, `WAIT`, `HTTP`,
`LINUX_DIAGNOSTICS`, `SYSTEMD`, `DOCKER`, `KUBERNETES`, and `BASH`.
Host/container/cluster execution requires an eligible Agent with matching local
policy and platform permissions. HTTP and control-flow steps are control-plane
operations; a configured URL still undergoes server-side validation.

Nested `precheck` and `verification` definitions are supported through Advanced
JSON. They are preserved during ordinary builder editing. See the
[authoring example](../guides/runbooks/author).

## Inputs and risk

Input types are `STRING`, `NUMBER`, `BOOLEAN`, `URL`, `DURATION`, and `SECRET_REF`.
Unconstrained `SELECT` is not accepted for new input definitions; use `STRING`
until option-aware selection is implemented. The database retains its legacy
enum value for compatibility, not as a constrained dropdown contract.
Input keys are unique and definitions specify required/default
behavior. Values are validated when configuring and executing a binding.
Secret references identify encrypted credentials and require a scoped grant.

Risk classes are `READ_ONLY`, `IDEMPOTENT_WRITE`, and `NON_IDEMPOTENT`.
Minimum risk is derived from the action. Non-idempotent actions require explicit
approval; authors cannot make a restart safe by relabeling its risk.

The maximum is 50 steps, including nested steps, and 30 input definitions.
Library filtering currently operates on loaded Runbooks. Execution history
currently shows the most recent 50 executions; server-side pagination is not
yet available.

## Bash executor

`BASH` steps run with Bash, not POSIX `sh`. The container Agent includes Bash;
native Agents must install Bash on their `PATH`. Commands use a non-login,
non-interactive shell without profile/rc or inherited `BASH_ENV` startup files.

## CONDITION fields and behavior

Builder conditions select `incident.priority`, `incident.urgency`,
`incident.status`, `incident.title`, `incident.description`, `incident.tags`,
`service.name`, or a defined input such as `input.replica_count`.
Advanced definitions can also access incident/service IDs and `service.teamId`.
Incident/service values are read when the condition executes, not frozen at
execution creation. Without an incident/service, those objects are absent.
Inputs are the execution's resolved values. Legacy bare incident paths such as
`priority` are interpreted as `incident.priority`.

The server rejects unsupported fields and operators when saving, publishing,
or starting a workflow. `input.<key>` must name a declared runbook input.
Trigger conditions allow only the listed incident/service fields, never inputs.
Stored triggers with invalid paths are suppressed before matching, including
`NOT_EXISTS` and `NOT_EQUALS`; a misspelled field cannot activate automation.

A false CONDITION skips itself and all remaining pending workflow steps.
It is a workflow gate, not an if/else branch. Operators use strict type
comparison: numeric inputs require JSON numbers, not quoted strings.
Use Advanced JSON for non-string comparison values.

Control-plane HTTP steps reject private, loopback, link-local, and metadata
endpoints through safe outbound fetching. Internal remediation needs an
appropriate Agent executor, such as an explicitly allowlisted Bash command,
not an exemption from control-plane SSRF rules.

## Permissions

- `runbook.read.all`: global Runbook views.
- `runbook.read.scoped`: scoped access, subject to resource authorization.
- `runbook.manage`: create drafts, edit workflows, and manage service bindings.
- `runbook.publish`: publish an immutable version.
- `runbook.execute`: start and request cancellation of executions.
- `runbook.approve`: approve a step's exact plan.
- `runbook.agent.manage`: enroll/revoke Agents and manage pools.
- `runbook.secret.manage`: create secrets, manage grants, and rotate values.

Service and incident authorization checks apply in addition to these capabilities.
See [permissions](./permissions) for the broader authorization model.

## Current boundaries

First-class nested-check builder controls, paginated library/history views,
execution-signing identity rotation, and fleet/load certification are not
documented as completed features. Existing encryption-key migration preserves
the execution-signing identity; it is not signing-identity rotation.
