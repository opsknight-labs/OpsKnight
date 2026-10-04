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

Nested `precheck` and `verification` definitions have first-class typed Builder
controls and remain compatible with Advanced JSON. See the
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
Library, execution history and Agent lists use server-side filtering and stable
20-row pages. Library filters include text, publication state, owner and service;
history includes status, Runbook, service, incident, Agent, date range and trigger;
Agents include pool, status, platform, capability and `key=value` labels.

## Typed diagnostics and runtime actions

Linux diagnostics support `summary`, `disk`, `memory`, `processes`, `network`,
`listeners`, `process` (pattern), `filesystem` (path), `journal` (unit/lines),
`dns` (hostname), `tcp` (host/port), and `http` (url/expectedStatus).
Agent-local HTTP checks can reach private services only when both the exact
hostname and port are in local `networkHosts` / `networkPorts`. Redirects and
URL credentials are rejected. DNS uses an allowlisted host and port 53.
Systemd `logs` and journal diagnostics use fixed argv and 1–500 lines.

`DOCKER` config supports `runtime: "docker"` (default) or `"podman"`, with
`inspect`, `logs`, `health`, `start`, `stop`, and `restart`. Podman uses an
independent `podmanContainers` allowlist and effective runtime capability.
The health action requires a configured healthcheck reporting `healthy`; merely
running, starting, unhealthy or absent healthchecks do not pass that action.
Kubernetes adds `events`, `rollout-status`, and `scale`. Scale requires an exact
resource/name, integer `replicas`, `IDEMPOTENT_WRITE` or stronger risk, and local
namespace/action/`kubernetesMaxReplicas` authorization. Restart remains
`NON_IDEMPOTENT`. Platform RBAC is an independent boundary.

## Evidence and verified recovery

Attempts persist bounded structured `preState` and `postState` snapshots. They
include CPU load/cores (not CPU percentage), memory, load, and relevant service,
container, Kubernetes, network, disk, process or log evidence when available.
Incident step details show changes and retain downloadable raw output artifacts.
Secret input values are redacted from evidence and output.

`Verified recovery` is a persisted verification result, not an execution status.
It requires a successful workflow and write action, successful authored
verification checks, and positive healthy post-state. Failed capture, unhealthy
containers/services/checks or unconverged Kubernetes generations cannot receive
the badge. Metrics or exit code zero alone are insufficient. Scale-to-zero does
not prove recovery. Evidence reflects what the execution Agent observed; it is
not an independent external availability guarantee.

## Targeting and automatic budgets

Administrators own Agent scheduling labels. Agent heartbeats cannot change them.
Pools combine explicit members with label-selector matches; removing a dynamic
member requires changing the selector or labels. Service bindings can target
a specific Agent, a pool, or an `agentSelector` JSON map. Values can reference
`${{ inputs.host }}` or `${{ incident.labels.host }}`; incident labels use
`key=value` incident tags. Local write selectors must resolve to one healthy,
capable Agent. Shared targets select an eligible member. The selected identity
and selector/pool provenance are snapshotted; queued writes never switch hosts
when labels change. An absent/ambiguous match fails closed.

Under **Runbooks → Agents → Automatic remediation budgets**, administrators set
per-incident execution/write/non-idempotent limits (defaults 3/3/0). Automatic
execution reserves the entire authored plan transactionally under an incident
lock; failed or canceled attempts do not refund that conservative budget.
Exhaustion becomes a frozen suggestion requiring responder action instead of
silently dropping remediation. Explicit responder executions still require
normal risk approvals and local policy, but do not consume automatic budgets.
Incident Runbooks shows usage. Existing service/pool circuit and concurrency
limits remain active.

## Signing and effective capabilities

Signing identities rotate through ACTIVE → RETIRING → RETIRED with NEXT staged
alongside ACTIVE. Distribute the trusted `OPSKNIGHT_EXECUTION_PUBLIC_KEYS` JSON
map before activating NEXT; every enrolled non-revoked Agent, including offline
Agents, must acknowledge its ID. Retire the old key only after the 24-hour grace
period. IDs are signed inside execution and lease envelopes. Private signing
keys remain encrypted; the UI exposes only public pins. See
[Agent operations](../operate/deploy/agent-operations).

Agents probe configured binaries and runtime access before heartbeats. The UI
distinguishes configured/unavailable from effective capabilities; scheduling
uses effective capabilities and distinguishes Docker from Podman. Probes are
bounded and read-only, and never grant Unix privileges or Kubernetes RBAC.

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
