---
title: Runbook reference
description: Supported step and input types, risk classes, permissions, and authoring limits.
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

The supported types are `MANUAL`, `APPROVAL`, `CONDITION`, `WAIT`, `HTTP`,
`LINUX_DIAGNOSTICS`, `SYSTEMD`, `DOCKER`, `KUBERNETES`, and `BASH`.
Host/container/cluster execution requires an eligible Agent with matching local
policy and platform permissions. HTTP and control-flow steps are control-plane
operations; a configured URL still undergoes server-side validation.

Nested `precheck` and `verification` definitions have first-class typed Builder
controls and remain compatible with Advanced JSON. See the
[authoring example](../guides/runbooks/author).

## Inputs and risk

Input types are `STRING`, `NUMBER`, `BOOLEAN`, `URL`, `DURATION`, `SECRET_REF`
and `SELECT`. SELECT definitions require explicit unique options; saved defaults,
binding values and execution inputs must match an allowed option. See the
[authoring guide](../guides/runbooks/author) for the current Builder controls.
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
Incident step details show changes and retain downloadable sanitized output artifacts for authorized administrators.
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
The condition editor produces typed scalar and list values. Changing a field
normalizes each comparison value or clears it for re-entry. STRING comparisons
support equals, not equals, contains, starts with, in and not in; NUMBER and
BOOLEAN support equals, not equals, in and not in. EXISTS and NOT_EXISTS clear
the comparison. Incident tags support CONTAINS with a string member, and existence
checks. Missing fields never satisfy value comparisons, including negative ones.
Automatic incident triggers retain strict comparison behavior.

HTTP actions accept a string-valued headers object and optional expected status
from 100–599. Without an expected status, any 2xx response succeeds. GET and HEAD
cannot contain request bodies. Control-plane HTTP cannot consume SECRET_REF
inputs. WAIT uses an integer `durationSeconds` from 0–86400, subject to its step
timeout and overall deadline. Fields named `seconds` are not WAIT duration controls.

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

## Rule and readiness contracts

`ServiceAutomationRule` is an independent configuration identity. Multiple rules may share a service and workflow; existing database table/IDs and history references are preserved. Readiness states are PAUSED, BLOCKED, CHECKS_REQUIRED, CONFIGURATION_VALID and UNKNOWN. Online/capable Agents cannot alone produce a target-permission guarantee. Agent policy checks are signed, scoped, one-time results with an exact frozen action list; a matching fresh policy hash is required before using their evidence.

Worker health states are HEALTHY, DEGRADED and UNKNOWN. Shared PostgreSQL evidence, rather than the web process's local worker state, establishes dispatch and reconciliation freshness. The scheduler watchdog only reconciles durable work and preserves unknown-write fences.

## Bounded nonce maintenance

Replay nonces are purged independently of execution recovery, using the same
isolated one-connection maintenance pool as artifact retention. A nonce batch
selects at most 1,000 expired IDs through the `createdAt` index and uses
`FOR UPDATE SKIP LOCKED`, its own advisory lock, a one-second statement deadline,
a 100 ms lock deadline and a 2.5-second transaction deadline. Slow batches skip
scheduler ticks; they do not overlap or run an unbounded backlog-draining loop.
Nonce batches run at most once per second; artifact batches retain their
one-minute cadence. These limits bound work, rather than certify fleet capacity.

Nonce retention covers both sides of the five-minute signature window plus
one minute of margin. Purging uses the database clock and preserves recent
nonces, including accepted future-dated requests. Signed requests outside the
window remain invalid after their stored nonce expires.

Monitor `opsknight_runbook_nonce_purge_rows_total`,
`opsknight_runbook_nonce_purge_batches_total{result="failed"}`,
`opsknight_runbook_nonce_purge_duration_seconds` and
`opsknight_runbook_nonce_purge_oldest_expired_age_seconds`. The age gauge records
the oldest expired candidate before the last successful batch; skipped or
failed batches preserve its previous observation. Growing age or failure counts
need investigation of maintenance throughput and database health. They do not
mean that valid nonce replay protection has been disabled.

## Maintenance alerts

The bundled [Prometheus rules](https://github.com/opsknight-labs/OpsKnight/blob/main/monitoring/prometheus/opsknight-alerts.yaml)
include nonce and artifact maintenance alerts for:

- **Stalled:** no successful batch in the last five minutes while execution
  workers report healthy, sustained for five minutes (nonces) or ten minutes
  (artifacts). Missing maintenance samples also trigger this check.
- **Lagging:** oldest expired data observed by an active maintenance process
  exceeds five minutes (nonces) or one hour (artifacts), sustained for five minutes.
- **Failing:** at least three failed transactions over ten minutes, sustained
  for two minutes. Advisory-lock skips are separate from transaction failures.

Scrape each scheduler process's authenticated `/api/metrics` endpoint as well as
the web endpoint (or every integrated replica when using the integrated role):
maintenance counters and age observations are process-local. Keep the
Prometheus `job` and `instance` labels for matching. Load these rules per
OpsKnight deployment; aggregate the workers of that deployment together, without
combining unrelated deployments. Backlog alerts require recent successful batches
from the same process, so a former leader's stale age gauge does not keep them
firing. Existing worker-health alerts cover missing or degraded execution workers.

`opsknight_runbook_artifact_purge_oldest_expired_age_seconds` measures age beyond
the configured retention cutoff before the last successful batch, matching the
nonce observation semantics. Empty successful batches reset age to zero; skipped
and failed batches preserve it. An empty backlog is healthy even if no rows are
deleted. Investigate database latency, locks and maintenance logs before changing
cadence or capacity. Never clear replay protection by truncating recent nonces.
The rule tests cover healthy idle maintenance, missing/stopped cleanup, backlog,
repeated failures, a stale former leader and recovery after the backlog drains.

## Current boundaries

Nested-check builder controls, signing rotation, structured selectors, independent rules and static version comparison are implemented. Version comparisons mask credential fields and list effects on latest-publication rules while pinned rules retain their versions. These features do not certify all deployment topologies or fleet capacity. The measured 10/100/1000 Agent simulation is direct-library idle claim load; it is not authenticated production network capacity or physical recovery proof. Promote only released server/Agent pairs with completed topology evidence.


Runbooks remains **Beta** in v2.1. Configuration checks, policy evidence, browser
journeys and candidate deployment tests each establish a limited property.
Release qualification still requires the published server/Agent pair, physical
write and recovery evidence on the intended Systemd/container/Kubernetes targets,
HA and fault scenarios, sustained authenticated workload measurements, and human
accessibility review. Candidate builds, simulations and a successful preview
cannot substitute for those environment-specific results. Follow
[Agent operations](../operate/deploy/agent-operations) for deployment prerequisites.

## Enterprise safety and output access

Service rule creation, edits, trigger changes, activation, pause, duplication,
detachment and policy-check requests require **both** service modification
authority and `runbook.manage`. A service-team responder's read/execute/approve
permissions do not grant rule administration. UI controls follow the same rule;
server actions enforce it independently.

Deadline handling is shared by worker advancement and recovery. Once the deadline
passes, pending/claimed attempts lose authority. A running Agent attempt stays
fenced and nonterminal while its result or lease expiry is reconciled. A result
produced before deadline may still be recorded with its valid lease. A write
reported after deadline is recorded as UNKNOWN, rather than successful or
silently discarded. UNKNOWN writes require independent target verification;
recovery never schedules a deadline-expired retry.

Agent output passes through shared credential sanitization before local spooling.
Docker inspect/health and Kubernetes diagnostics project operational state rather
than dumping environment/configuration payloads. Agent policy rejects Secret and
ConfigMap resource capture. The control plane independently validates gzip/UTF-8,
limits decompression to 10 MiB, sanitizes text and retains at most 1 MiB plus a
truncation marker before recompressing and persisting. Stored checksums and byte
quotas describe this sanitized payload. Repeated normalized uploads remain
idempotent. These limits complement the existing per-attempt/execution quotas.

Artifact downloads require `runbook.artifact.download` in addition to Runbook read
and resource access. The built-in ADMIN role holds this capability; RESPONDER and
AUDITOR do not. Downloads are audited and sanitized again, including artifacts
stored before this change. The `x-content-sha256` header describes the returned
sanitized gzip. A historical artifact's stored hash may describe its older payload.
Invalid or oversized legacy gzip cannot be downloaded through this endpoint.

Pattern matching cannot identify every credential in arbitrary application logs.
Treat output as sensitive operational data, avoid collecting credentials, use
encrypted PostgreSQL storage/backups and restrict database/spool access. Existing
historical database rows and backups require an operator's data-protection review
and retention process; download sanitization does not rewrite old backups.

## Idle Agent claim behavior

A process-local negative queue hint coalesces concurrent availability probes and
expires after one second. It caches no Agent authority, lease or eligible result.
Every actual claim still checks live Agent status, policy, permissions and lease
fences. Newly available work can incur the one-second hint delay plus the existing
2–5 second polling cadence. Long polls respect their remaining wait budget and
abort when the client disconnects.

`opsknight_runbook_claim_availability_probes_total{result="empty"}` measures
coalesced database probes; `result="work"` reports a nonempty hint. A pending but
ineligible backlog still requires Agent-specific eligibility checks. This reduces
idle repeated-query cost; it does not establish fleet capacity. See the
[enterprise qualification guide](../operate/deploy/runbook-qualification).
