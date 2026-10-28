---
title: Runbook permissions and security
description: All capabilities, API scopes, service authorization, artifact access, and signing key management.
type: how-to
product_area: runbooks
audience: [administrator]
verification:
  level: source
  verified_at: 2026-10-15
  evidence: [src/lib/authorization.ts, src/lib/runbooks/types.ts, src/lib/runbooks/agent-claims.ts]
---

# Runbook permissions and security

Runbook operations are governed by **capabilities** (interactive users) and
**API scopes** (machine-to-machine). Service and incident authorization checks
apply in addition to these.

## UI/interactive capabilities

| Capability                  | Constant                    | What it allows                                                          |
| --------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `runbook.read.all`          | `RUNBOOK_READ_ALL`          | View all Runbooks, executions, Agents, and health                       |
| `runbook.read.scoped`       | `RUNBOOK_READ_SCOPED`       | View only service-scoped Runbooks (reserved for future scoped views)    |
| `runbook.manage`            | `RUNBOOK_MANAGE`            | Create/edit/archive/delete drafts, manage service bindings, set budgets |
| `runbook.publish`           | `RUNBOOK_PUBLISH`           | Publish an immutable version, retire versions                           |
| `runbook.execute`           | `RUNBOOK_EXECUTE`           | Start executions, request cancellation, re-run                          |
| `runbook.approve`           | `RUNBOOK_APPROVE`           | Approve a step's exact plan                                             |
| `runbook.agent.manage`      | `RUNBOOK_AGENT_MANAGE`      | Enroll/revoke Agents, manage pools, rotate signing keys                 |
| `runbook.secret.manage`     | `RUNBOOK_SECRET_MANAGE`     | Create secrets, manage grants, rotate values                            |
| `runbook.artifact.download` | `RUNBOOK_ARTIFACT_DOWNLOAD` | Download step output artifacts                                          |
| `admin.manage`              | `ADMIN_MANAGE`              | Set artifact retention policy                                           |

The built-in `ADMIN` role holds `runbook.artifact.download`. `RESPONDER` and
`AUDITOR` do not. Downloads are audited and sanitized, including artifacts
stored before this change.

## API scopes (machine-to-machine)

| Scope                       | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `runbook-rules:read`        | Read automation rules                    |
| `runbook-rules:write`       | Create/update rules                      |
| `runbook-rules:activate`    | Enable/activate rules                    |
| `runbook-agents:read`       | Read Agent fleet                         |
| `runbook-agents:write`      | Update Agent metadata/labels             |
| `runbook-agents:enroll`     | Create enrollment tokens                 |
| `runbook-agents:revoke`     | Revoke Agents                            |
| `runbook-agent-pools:write` | Create/update pools                      |
| `runbook-secrets:read`      | List secrets (values are never returned) |
| `runbook-secrets:write`     | Create/rotate secrets                    |
| `runbook-secrets:grant`     | Grant/revoke secret access               |
| `runbook-signing:read`      | Read signing keys                        |
| `runbook-signing:write`     | Rotate signing keys                      |
| `runbook-settings:read`     | Read system settings                     |
| `runbook-settings:write`    | Update artifact retention/budgets        |

## Service authorization

Service rule creation, edits, trigger changes, activation, pause, duplication,
detachment, and policy-check requests require **both** service modification
authority and `runbook.manage`. A service-team responder's read/execute/approve
permissions do not grant rule administration.

Viewing a service does not grant Runbook library access. The Runbooks view
requires `runbook.read.all`; other service views do not load the catalog,
rules, or Agent inventory.

## Artifact access and output security

### Download controls

- Artifact downloads require `runbook.artifact.download` in addition to
  Runbook read and resource access.
- Downloads are audited and sanitized again, including artifacts stored before
  this capability was introduced.
- The `x-content-sha256` header describes the returned sanitized gzip.
- Invalid or oversized legacy gzip cannot be downloaded through this endpoint.

### Output sanitization pipeline

1. Agent output passes through shared credential sanitization before local
   spooling.
2. Docker inspect/health and Kubernetes diagnostics project operational state
   rather than dumping environment/configuration payloads.
3. Agent policy rejects Secret and ConfigMap resource capture.
4. The control plane independently validates gzip/UTF-8, limits decompression
   to 10 MiB, sanitizes text, and retains at most 1 MiB plus a truncation
   marker before recompressing and persisting.
5. Stored checksums and byte quotas describe this sanitized payload.

Pattern matching cannot identify every credential in arbitrary application
logs. Treat output as sensitive operational data, avoid collecting credentials,
use encrypted PostgreSQL storage/backups, and restrict database/spool access.

## Signing key management

Execution signing uses a rotation protocol with zero downtime:

| Phase | Status                                       | Description                           |
| ----- | -------------------------------------------- | ------------------------------------- |
| 1     | **NEXT** staged alongside **ACTIVE**         | New key prepared but not yet signing  |
| 2     | **ACTIVE** activated, old key → **RETIRING** | New key signs; old key still accepted |
| 3     | Old key → **RETIRED** after 24-hour grace    | Only new key accepted                 |

Distribute the trusted `OPSKNIGHT_EXECUTION_PUBLIC_KEYS` JSON map before
activating NEXT. Every enrolled non-revoked Agent, including offline Agents,
must acknowledge its ID. Private signing keys remain encrypted; the UI exposes
only public pins. IDs are signed inside execution and lease envelopes.

## Unattended writes authorization

Automatic rules that include write steps require separate
`AUTOMATION_PUBLISH` capability authorization. This is scoped to a specific
`unattendedWritesVersionId`. Authorization is invalidated if the version,
inputs, target, or trigger conditions change (tracked via
`unattendedWritesScopeHash`).

## See also

- [Manage permissions](../../guides/administration/manage-permissions) for the
  broader authorization model.
- [Agents, pools, and secrets](./agents-pools-secrets) for infrastructure
  credentials.
- [Runbook reference](../../reference/runbooks) for detailed limits.
