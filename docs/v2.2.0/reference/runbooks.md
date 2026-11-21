---
title: Runbook reference
description: Complete reference for step types, input types, risk classes, state machines, permissions, limits, and maintenance.
type: reference
product_area: runbooks
audience: [administrator, operator, developer]
verification:
  level: source
  verified_at: 2026-10-15
  evidence:
    [
      src/lib/runbooks/types.ts,
      src/lib/runbooks/definition.ts,
      src/lib/runbooks/schemas.ts,
      src/lib/authorization.ts,
    ]
---

# Runbook reference

## Step types

| Type | Requires Agent | Risk range | Purpose |
|------|---------------|-----------|---------|
| `MANUAL` | No | `READ_ONLY` | Human instruction step |
| `APPROVAL` | No | `READ_ONLY` | Explicit approval gate |
| `CONDITION` | No | `READ_ONLY` | Workflow gate (server-side) |
| `WAIT` | No | `READ_ONLY` | Timed pause (0–86400s) |
| `HTTP` | No (control plane) | `READ_ONLY` → `NON_IDEMPOTENT` | Outbound HTTP request |
| `LINUX_DIAGNOSTICS` | Yes | `READ_ONLY` | 12 system diagnostic sub-types |
| `SYSTEMD` | Yes | `READ_ONLY` → `NON_IDEMPOTENT` | Systemd service lifecycle |
| `DOCKER` | Yes | `READ_ONLY` → `NON_IDEMPOTENT` | Container lifecycle (Docker/Podman) |
| `KUBERNETES` | Yes | `READ_ONLY` → `NON_IDEMPOTENT` | Cluster resource operations |
| `BASH` | Yes | `NON_IDEMPOTENT` (always) | Shell command execution |

Nested `precheck` and `verification` definitions have first-class typed
Builder controls and remain compatible with Advanced JSON.

## Step configuration schemas

### MANUAL / APPROVAL

```json
{ "instructions": "...", "description": "..." }
```

### CONDITION

```json
{ "field": "incident.priority", "operator": "EQUALS", "value": "P1" }
```

#### Supported condition fields

**Builder fields**: `incident.priority`, `incident.urgency`,
`incident.status`, `incident.title`, `incident.description`, `incident.tags`,
`service.name`, `input.<key>`.

**Advanced JSON fields**: Also supports incident/service IDs and
`service.teamId`.

Incident/service values are read when the condition executes, not frozen at
execution creation. Without an incident/service, those objects are absent.
Inputs are the execution's resolved values. Legacy bare incident paths such as
`priority` are interpreted as `incident.priority`.

#### Condition behavior

- A false CONDITION skips itself and all remaining pending workflow steps.
- It is a workflow gate, not an if/else branch.
- Operators use strict type comparison: numeric inputs require JSON numbers.
- The server rejects unsupported fields and operators when saving, publishing,
  or starting a workflow.
- `input.<key>` must name a declared Runbook input.
- Trigger conditions allow only incident/service fields, never inputs.
- Missing fields never satisfy value comparisons, including negative ones.

#### Condition operators

| Operator | Valid types | Notes |
|----------|-----------|-------|
| `EQUALS` | STRING, NUMBER, BOOLEAN | Exact match |
| `NOT_EQUALS` | STRING, NUMBER, BOOLEAN | Inverse match |
| `CONTAINS` | STRING | Substring match; incident tags support member check |
| `STARTS_WITH` | STRING | Prefix match |
| `IN` | STRING, NUMBER, BOOLEAN | One of a list |
| `NOT_IN` | STRING, NUMBER, BOOLEAN | None of a list |
| `EXISTS` | All | Field present; clears comparison value |
| `NOT_EXISTS` | All | Field absent; clears comparison value |
| `IS_MISSING` | `automation.*` only | Context field missing |
| `IS_UNMAPPED` | `automation.*` only | Context field unmapped |

### WAIT

```json
{ "durationSeconds": 30 }
```

Range: 0–86400. Subject to step timeout and overall deadline. Fields named
`seconds` are not WAIT duration controls.

### HTTP

```json
{
  "method": "GET",
  "url": "https://status.example.com/health",
  "headers": { "Accept": "application/json" },
  "body": "",
  "expectedStatus": 200
}
```

| Field | Constraints |
|-------|-----------|
| `method` | GET, HEAD, POST, PUT, PATCH, DELETE |
| `headers` | JSON object, string values, max 64 entries, 16 KiB total |
| `body` | Max 64 KiB. GET/HEAD cannot include a body |
| `expectedStatus` | 100–599. Without it, any 2xx succeeds |
| Config max | 96 KiB (larger than other types at 32 KiB) |

**Risk mapping**: GET/HEAD → `READ_ONLY`, PUT/DELETE → `IDEMPOTENT_WRITE`,
POST/PATCH → `NON_IDEMPOTENT`.

Control-plane HTTP rejects private, loopback, link-local, and metadata
endpoints. HTTP steps cannot consume `SECRET_REF` inputs.

### LINUX_DIAGNOSTICS

```json
{ "diagnostic": "<sub-type>", ...sub-type fields }
```

| Sub-type | Required fields | Description |
|----------|----------------|-------------|
| `summary` | — | Overall system summary |
| `disk` | — | Disk usage and mount points |
| `memory` | — | Memory utilization |
| `processes` | — | Running process list |
| `network` | — | Network interfaces and connections |
| `listeners` | — | Active listening ports |
| `process` | `pattern` | Processes matching a search pattern |
| `filesystem` | `path` | Specific filesystem path details |
| `journal` | `unit`, `lines` (1–500) | Systemd journal entries |
| `dns` | `hostname` | DNS resolution (allowlisted host, port 53) |
| `tcp` | `host`, `port` (1–65535) | TCP connectivity check |
| `http` | `url`, `expectedStatus` (100–599) | Agent-local HTTP check |

Agent-local HTTP checks require both hostname and port in `networkHosts` /
`networkPorts`. Redirects and URL credentials are rejected.

### SYSTEMD

```json
{
  "action": "restart",
  "unit": "api.service",
  "lines": 100,
  "expectedState": "active"
}
```

| Action | Risk | Notes |
|--------|------|-------|
| `status` | `READ_ONLY` | Check unit state |
| `logs` | `READ_ONLY` | 1–500 lines of journal output |
| `start` | `IDEMPOTENT_WRITE` | Start a stopped unit |
| `stop` | `IDEMPOTENT_WRITE` | Stop a running unit |
| `restart` | `NON_IDEMPOTENT` | Requires approval |

Unit names support `.service`, `.socket`, `.timer`, `.target`, and other
systemd unit types.

### DOCKER

```json
{
  "action": "inspect",
  "container": "checkout",
  "runtime": "docker"
}
```

| Action | Risk | Notes |
|--------|------|-------|
| `inspect` | `READ_ONLY` | Container metadata |
| `logs` | `READ_ONLY` | Container log output |
| `health` | `READ_ONLY` | Requires healthcheck reporting `healthy` |
| `start` | `IDEMPOTENT_WRITE` | Start a stopped container |
| `stop` | `IDEMPOTENT_WRITE` | Stop a running container |
| `restart` | `NON_IDEMPOTENT` | Requires approval |

Runtime: `"docker"` (default) or `"podman"`. Podman uses independent
`podmanContainers` allowlist.

### KUBERNETES

```json
{
  "action": "scale",
  "namespace": "payments",
  "resource": "deployment",
  "name": "checkout",
  "replicas": 3
}
```

| Action | Risk | Resources |
|--------|------|----------|
| `get` | `READ_ONLY` | All |
| `describe` | `READ_ONLY` | All |
| `logs` | `READ_ONLY` | pod, deployment, daemonset, statefulset |
| `events` | `READ_ONLY` | All |
| `rollout-status` | `READ_ONLY` | deployment, daemonset, statefulset |
| `rollout-restart` | `NON_IDEMPOTENT` | deployment, daemonset, statefulset |
| `scale` | `IDEMPOTENT_WRITE` | deployment, statefulset, replicaset, replicationcontroller |

Scale requires integer `replicas` and local `kubernetesMaxReplicas`
authorization. Platform RBAC is an independent boundary.

### BASH

```json
{ "command": "systemctl is-active -- \"$OPSKNIGHT_INPUT_SERVICE\"" }
```

Max 8 KiB. Always `NON_IDEMPOTENT`. Uses Bash (not POSIX `sh`), non-login,
non-interactive, without profile/rc or `BASH_ENV` startup files.

## Input types

| Type | Storage | Behavior |
|------|---------|----------|
| `STRING` | String | Free text |
| `NUMBER` | String → Number | Coerced via `Number()`, must be finite |
| `BOOLEAN` | String → Boolean | `"true"` → `true`, else `false` |
| `URL` | String | Validated as URL |
| `DURATION` | String | Duration string |
| `SECRET_REF` | String | `secret://<name>`, resolved at dispatch |
| `SELECT` | String | One of `options[]` values |

Maximum: 30 input definitions per workflow.

### Input template syntax

`${{ inputs.key }}` — keys must be lowercase. Exact match preserves typed
value; embedded in a string coerces to string.

## Risk classes

| Class | Meaning | Retry after failure | Retry after UNKNOWN |
|-------|---------|-------------------|-------------------|
| `READ_ONLY` | No state change | ✅ | ✅ |
| `IDEMPOTENT_WRITE` | Repeatable state change | ✅ | ❌ |
| `NON_IDEMPOTENT` | Cannot safely retry | ❌ | ❌ |

Minimum risk is derived from the action. Non-idempotent actions require
explicit approval. Authors cannot make a restart safe by relabeling its risk.

## State machines

### Execution states

```
QUEUED → RUNNING → WAITING_AGENT → WAITING_APPROVAL
                                        │
         ┌──────────────────────────────┘
         ▼
  SUCCEEDED │ FAILED │ TIMED_OUT │ CANCELLED │ CANCEL_REQUESTED
```

### Step states

```
PENDING → READY → RUNNING → WAITING_AGENT → WAITING_APPROVAL
                                                  │
         ┌────────────────────────────────────────┘
         ▼
  SUCCEEDED │ FAILED │ SKIPPED │ CANCELLED │ UNKNOWN
```

### Attempt states

```
PENDING → CLAIMED → RUNNING → SUCCEEDED │ FAILED │ CANCELLED │ TIMED_OUT │ UNKNOWN
```

## Approval mechanics

- Steps with `requiresApproval: true` or type `APPROVAL` pause at
  `WAITING_APPROVAL`.
- Approval requires `runbook.approve` capability.
- Plan digest computed from: step key + step type + risk class + config +
  agent/pool ID + input values + version checksum.
- Approver signs the **exact same digest** — any change requires re-approval.
- Circuit breaker exhaustion also transitions to `WAITING_APPROVAL`.

## Preview authorization

- Issued for 5 minutes, single-use.
- Bound to account, incident, service binding, and suggestion.
- Cannot be reused by another responder or incident.
- Issuance/consumption recorded in audit trail (no token stored).
- Temporary records purged 30 days after expiry.

## Timeouts and leases

| Scope | Default | Notes |
|-------|---------|-------|
| Execution deadline | 3600 seconds (1 hour) | `deadlineAt` computed from start |
| Step timeout | 600 seconds (10 min) | Per-step |
| Agent lease | 300 seconds | Renewable |
| Agent policy can impose tighter maximum | — | Lease ≠ step timeout |

### Deadline handling

Once the deadline passes, pending/claimed attempts lose authority. A running
Agent attempt stays fenced while its result or lease expiry is reconciled. A
result produced before deadline may still be recorded. A write reported after
deadline is recorded as UNKNOWN, not successful or discarded.

## Evidence and verified recovery

Attempts persist bounded structured `preState` and `postState` snapshots
including CPU load/cores, memory, load, and relevant service/container/
Kubernetes/network/disk/process/log evidence.

**Verified recovery** requires:

- ✅ Successful workflow and write action.
- ✅ Successful authored verification checks.
- ✅ Positive healthy post-state.

What does not qualify:

- ❌ Failed capture or unhealthy containers/services/checks.
- ❌ Unconverged Kubernetes generations.
- ❌ Metrics or exit code zero alone.
- ❌ Scale-to-zero.

## Targeting

| Target type | Behavior |
|-------------|----------|
| Specific Agent | Exact machine target |
| Pool (SHARED_TARGET) | Any eligible member selected |
| Pool (LOCAL_HOSTS) | Writes require specific Agent when multi-member |
| Agent selector (JSON) | Dynamic label matching |

Values can reference `${{ inputs.host }}` or `${{ incident.labels.host }}`.
The selected identity and selector/pool provenance are snapshotted; queued
writes never switch hosts when labels change.

## Permissions

| Capability | Actions |
|-----------|---------|
| `runbook.read.all` | View all Runbooks, executions, Agents |
| `runbook.read.scoped` | Scoped access (reserved) |
| `runbook.manage` | Create/edit/archive drafts, manage bindings |
| `runbook.publish` | Publish immutable versions |
| `runbook.execute` | Start/cancel executions |
| `runbook.approve` | Approve exact plans |
| `runbook.agent.manage` | Enroll/revoke Agents, manage pools |
| `runbook.secret.manage` | Create/grant/rotate secrets |
| `runbook.artifact.download` | Download step output |

See [Permissions guide](../guides/runbooks/permissions) for API scopes.

## Limits

| Limit | Value |
|-------|-------|
| Maximum steps (including nested) | 50 |
| Maximum input definitions | 30 |
| Library/history page size | 20 rows |
| Bash command max size | 8 KiB |
| HTTP config max size | 96 KiB |
| Other step config max size | 32 KiB |
| HTTP headers max entries | 64 |
| HTTP headers max total size | 16 KiB |
| HTTP body max size | 64 KiB |
| Journal/log lines range | 1–500 |
| Trigger conditions per trigger | 20 |
| Enrollment token lifetime | 15 minutes |
| Agent heartbeat freshness | 90 seconds |
| Preview authorization lifetime | 5 minutes |
| Nonce purge batch size | 1,000 IDs |
| Nonce retention window | 5-minute signature window + 1 minute margin |
| Artifact decompression limit | 10 MiB |
| Output retention per attempt | 1 MiB + truncation marker |
| Artifact retention range | 1–3,650 days |
| Export max size | 512 KiB |
| Import slug dedup attempts | 5 |
| Agent name max length | 200 chars |
| Agent hostname max length | 255 chars |
| Pool name max length | 200 chars |
| Pool description max length | 1,000 chars |
| Policy certification max Agents | 100 per target |
| Policy certification batch size | 25 |
| WAIT duration range | 0–86,400 seconds |
| HTTP expected status range | 100–599 |
| TCP port range | 1–65,535 |
| Precheck/verification nesting | 3 levels |
| Checks per group | 10 |
| Auto remediation budget defaults | 3 executions / 3 writes / 0 non-idempotent |
| Auto remediation budget max | 100 each |
| Circuit breaker threshold | 3 failures in 15 minutes |

## Signing and effective capabilities

Signing identities rotate through ACTIVE → RETIRING → RETIRED with NEXT
staged alongside ACTIVE. Distribute `OPSKNIGHT_EXECUTION_PUBLIC_KEYS` before
activating NEXT. Every enrolled non-revoked Agent must acknowledge its ID.
Private keys remain encrypted; the UI exposes only public pins.

Agents probe configured binaries and runtime access before heartbeats.
Scheduling uses effective capabilities and distinguishes Docker from Podman.

## Rule and readiness contracts

`ServiceAutomationRule` is an independent configuration identity. Readiness
states: PAUSED, BLOCKED, CHECKS_REQUIRED, CONFIGURATION_VALID, UNKNOWN.

Worker health states: HEALTHY, DEGRADED, UNKNOWN. Shared PostgreSQL evidence
establishes dispatch and reconciliation freshness.

## Bounded nonce maintenance

Replay nonces are purged using an isolated one-connection maintenance pool.
Each batch selects at most 1,000 expired IDs through the `createdAt` index
using `FOR UPDATE SKIP LOCKED`, its own advisory lock, a one-second statement
deadline, 100 ms lock deadline, and 2.5-second transaction deadline.

### Maintenance alerts

The bundled Prometheus rules include alerts for stalled, lagging, and failing
maintenance for both nonces and artifacts:

| Alert | Nonce threshold | Artifact threshold |
|-------|----------------|-------------------|
| Stalled | 5 min no success | 10 min no success |
| Lagging | Oldest > 5 min | Oldest > 1 hour |
| Failing | ≥3 failures / 10 min | ≥3 failures / 10 min |

## Enterprise safety

Deadline handling is shared by worker advancement and recovery. UNKNOWN writes
require independent target verification. Agent output passes through shared
credential sanitization. Docker inspect/health and Kubernetes diagnostics
project operational state rather than dumping payloads.

## Idle Agent claim behavior

A process-local negative queue hint coalesces concurrent availability probes
and expires after one second. Every actual claim checks live Agent status,
policy, permissions, and lease fences. Newly available work can incur the
one-second hint delay plus the 2–5 second polling cadence.

## Current boundaries

Runbooks remains **Beta** in v2.1. Configuration checks, policy evidence,
browser journeys, and candidate deployment tests each establish a limited
property. Release qualification requires the published server/Agent pair,
physical write and recovery evidence, HA/fault scenarios, sustained workload
measurements, and human accessibility review. Follow
[Agent operations](../operate/deploy/agent-operations) for deployment
prerequisites.
