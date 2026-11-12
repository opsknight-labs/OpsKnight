---
title: MCP security and data
order: 5
description: What reaches your AI assistant's vendor, what the assistant can see, what is always removed, what OpsKnight stores and logs, and the controls.
type: concept
product_area: mcp
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-11-09
  evidence:
    - src/lib/mcp/core/projection.ts
    - src/lib/mcp/auth/effective-access.ts
    - src/lib/mcp/auth/cimd.ts
    - src/lib/mcp/protocol/server.ts
    - scripts/mcp/docs-reference.ts
---

# MCP security and data

This page is for the people deciding whether to turn MCP on. The short version: OpsKnight keeps your data in your PostgreSQL, but **whatever an assistant reads is sent to that assistant and its model vendor**.

## Data flow

```text
person ──► assistant client ──► assistant vendor's model
                │
                └── HTTPS /mcp (OAuth bearer) ──► OpsKnight ──► PostgreSQL
```

Every tool or resource result goes back to the assistant client and, from there, to its model vendor: incident titles and notes, alert payload summaries, display names, runbook text and anything else the assistant reads. How long the vendor keeps it, and whether it trains on it, depends on your contract with that vendor, not on OpsKnight. Choose assistants and plans whose data terms you accept.

## What an assistant can see

At most what the signed-in person can see, and usually less. On every request:

```text
visible = the person's current role and team membership
        ∩ the scopes they approved for this connection
        ∩ the administrator's ceiling
        − capabilities turned off under Exposed capabilities (all roles, their role, this assistant)
        (sensitive reads only while an administrator allows them)
```

The [permissions reference](../../reference/mcp/permissions.md) lists every scope and the roles that can use it. `whoami` never returns an email address.

## What is always removed

Results pass through a recursive projection before they leave the server. It removes:

- <!-- generated:mcp-redacted-fields -->Any field whose name contains `secret`, `password`, `token`, `credential`, `authorization`, `apikey` (with or without a separator), `signedurl` (with or without a separator), `email`, `phone`, `payload`, `rawOutput`, `stdout`, `stderr` (in any letter case), and any field named exactly `definition`, `config`, `inputValues`, `executionPlan`, `environment`, `env`.<!-- /generated:mcp-redacted-fields -->
- Bearer tokens and OpsKnight API keys inside text.
- URLs that carry credentials or a query string (they may grant access).
- Email addresses inside text, such as a timeline line saying a war-room invitation to `name@example.com` failed; each becomes `[REDACTED_EMAIL]`, and the result's `redactedFields` lists where.

People directory and audit reads go further: they keep only reviewed fields before that projection runs. `listUsers` and `getUser` return id, name, role, status and teams, never email, phone, time zone, department or job title, and an assistant’s `listUsers` search matches names only, so it cannot test whether an email address belongs to someone. `listAuditLogs` (Administrators and Auditors, sensitive reads on) drops the actor's email and IP address. Audit and report exports are not available to assistants.

Secrets typed into free text are not detected. A password pasted into an incident note is returned like any other note text. Field-name redaction alone does not prove that no secret can be disclosed.

## What OpsKnight stores and logs

- **Connections:** grant, token and consent metadata. Tokens are stored only as keyed HMAC digests, never as bearer strings. Expired grant, code, token and consent records are removed after a seven-day replay-detection window. Automatically registered assistants that never signed anyone in are deleted after 30 days.
- **Reviewed changes:** the frozen request is stored as an encrypted envelope until it is committed, rejected or expires; unused runbook previews follow the native preview retention window (30 days after expiry). Finished approval records (committed, failed, rejected or expired) are deleted 90 days after the request; the `mcp.operation.*` audit events remain.
- **Audit log:** consent, connection and client revocation, policy changes, exports of the usage log (`mcp.usage.exported`), approvals and committed changes, and sensitive reads (`mcp.sensitive_read`).
- **Request log:** one row per request with the tool, the outcome, how long it took, the request id, an error code and the ids of the assistant and the person. It never holds arguments, results or free text, and it is kept for 30 days unless an administrator sets 7 to 365 days under Access policy. Administrators read it on the **Usage** tab (calls, failures and slowest 5% by tool, assistant or person) and can export it as CSV or JSON; each export is audited.
- **Server log:** <!-- generated:mcp-log-events -->The server writes 24 MCP log events: `mcp.authorize.client_denied`, `mcp.authorize.invalid_request`, `mcp.authorize.unexpected_error`, `mcp.call_log.write_failed`, `mcp.cimd.client_denied`, `mcp.cimd.client_id_rejected`, `mcp.cimd.document_rejected`, `mcp.cimd.fetch_failed`, `mcp.device.client_denied`, `mcp.device.unexpected_error`, `mcp.grant.last_call_failed`, `mcp.register.unexpected_error`, `mcp.request.completed`, `mcp.request.unexpected_error`, `mcp.revoke.unexpected_error`, `mcp.sensitive_read.audit_failed`, `mcp.subscription.access_lost`, `mcp.subscription.listener_failed`, `mcp.subscription.poll_failed`, `mcp.token.grace_reissued`, `mcp.token.refresh_reuse_revoked`, `mcp.token.transient`, `mcp.token.unexpected_error`, `mcp.tool.unexpected_error`. Each is explained in [troubleshooting](troubleshooting.md#server-log-events).<!-- /generated:mcp-log-events --> Log lines never contain tokens, secrets or tool arguments.

The only outbound request OpsKnight makes for MCP is fetching an assistant's client metadata document: HTTPS to a public address, pinned, with no redirects, a 3-second timeout and a 5 KiB cap. If a published document changes so that OpsKnight rejects it, the reason is logged as `mcp.cimd.document_rejected`.

## Controls

- **Enable MCP** (Access policy) turns every MCP surface off at once; `MCP_FORCE_DISABLED=true` does the same from the deployment, whatever the stored policy says.
- **Allow reviewed sensitive configuration reads** is off by default.
- **Changes** are off by default; configuration changes and runbook runs always wait for a person to approve them in OpsKnight, and an assistant can never approve.
- **Exposed capabilities** turns off individual tools, operations or whole areas, for everyone, for one role or for one assistant (see below).
- **Revoke** one connection on the Connections tab, or **Revoke all active connections** (Connections tab, Credential security) in an emergency.

### Restrictions for all roles, one role or one assistant

**Exposed capabilities** has a **Restrictions for** selector with three kinds of list:

- **All roles** applies to every connection.
- **Role: User**, **Admin**, **Responder** or **Auditor** applies to people whose current role is that role. A role change takes effect on their next request.
- **An assistant** (a registered client) applies to everyone who connects through it. Personal access tokens are not an assistant and use the role and global lists only. The **Assistants** tab marks assistants that have their own restrictions.

The lists only add up: a capability is unavailable when any list that applies turns it off, and no list can turn back on what another turned off. The combined list hides the capability from `tools/list` and search, and it is checked again when the call runs, inside the same database transaction as any change it makes, so a restriction saved between listing and running still stops the call.

Removing an entry from any list widens access, so it needs the same recent sign-in as the global list. Each save is written to the audit log with the scope (`all roles`, `role USER`, `assistant <name>`) and the exact entries added and removed.

If the stored role list was edited by hand and cannot be read, OpsKnight turns everything off for the affected role (for every role when the whole value is unreadable), except Admin, so a damaged row cannot quietly widen access or lock administrators out. The settings page shows that role as fully restricted; saving any role rewrites the value in its correct form.

See also the [architecture and threat model](../../operate/mcp/architecture.md).
