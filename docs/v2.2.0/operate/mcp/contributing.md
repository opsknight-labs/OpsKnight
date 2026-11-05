---
title: Contributing to MCP
order: 5
description: Run the local MCP checks, call the server by hand and exercise the reviewed-change workflows in development.
type: developer
product_area: mcp
audience: [developer, operator]
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - scripts/mcp/local-check.cjs
    - src/app/mcp/route.ts
    - src/lib/mcp/protocol/server.ts
    - src/lib/mcp/approvals/operation.ts
    - src/lib/mcp/approvals/runbook.ts
---

# Contributing to MCP

This page is for developers and operators working on OpsKnight itself. To build your own agent or integration against an OpsKnight server, see [Build an agent](../../guides/mcp/build-an-agent.md). To turn MCP on and connect an assistant, follow [Self-hosted setup](../../guides/mcp/self-hosted-setup.md); for error codes see [Troubleshooting](../../guides/mcp/troubleshooting.md).

MCP is off by default and an administrator turns it on in one click. It is not certified for production capacity; two-replica shared-state behaviour is checked locally but is not a high-availability claim. See [architecture and outstanding work](architecture.md).

## Local checks

Install the locked dependencies on Node 20 (`npm ci --legacy-peer-deps`), start Docker, then run `npm run check:mcp:local`. It creates its own PostgreSQL 16 container bound to loopback, installs all migrations into fresh test and browser databases, generates disposable secrets, runs typecheck, the MCP unit, database and coverage checks, builds the production app and tests native consent, read, two-user review and revoke in Chromium, Firefox and WebKit. It prints a private evidence directory outside git and removes its server and container on exit. Linux hosts need Playwright's system dependencies first. This local check does not satisfy final-SHA release certification.

After a completed unit and database run, `npm run check:mcp:local -- --browser-only` repeats only the fresh database, production build and browser checks. Evidence records `mode: "browser-only"`; skipped checks are not reported as passing. `BUILD_DIR` selects a separate build directory when a development server is already running. The production build defaults to a 6 GB Node heap unless `NODE_OPTIONS` is set.

The evidence directory also has `query-profile.json`: statement counts for discovery, single reads, joined incident context, a three-step plan and four concurrent searches against the small fixture. For an existing disposable test database, set `MCP_QUERY_PROFILE_OUTPUT` to an absolute path outside the repository and run `npm run test:mcp:db`. The test resets data and accepts only a loopback PostgreSQL database whose name ends in `_test`. It records no SQL text, parameters, credentials or business content.

The generated [troubleshooting](../../guides/mcp/troubleshooting.md) and [permissions](../../reference/mcp/permissions.md) pages are written by `npm run mcp:docs`; `npm run mcp:docs:check` fails when they drift from the code.

## Manual development setup

1. Install dependencies, run `npx prisma generate` and deploy migrations with the normal safe migration process. Back up a populated database first.
2. No MCP environment variables are needed. In **Settings → System**, set the **App URL** to the HTTPS address users open (plain HTTP only on localhost). MCP builds its endpoint, OAuth issuer and protected-resource metadata from it. Credential digests use a key derived from the application encryption key, so every replica that shares the key accepts the same connections. Promoting a new active key disconnects every MCP client.
3. Sign in as an administrator and open **Settings → Integrations & ChatOps → MCP (AI Assistants)**. Click **Turn on AI assistant access** on the Overview tab, or set the switches on **Access policy**: **Enable MCP**, **Automatic connections**, the ceiling under **What assistants may do**, and **Workload limits** under **Advanced**. Start with `incidents:read services:read schedules:read` and changes off.
4. Discovery is at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/oauth/mcp`. The authorization-server document advertises `registration_endpoint` (ending in `/oauth/mcp/register`) while Automatic connections is on.
5. Use Authorization Code with PKCE S256 and `resource=<origin>/mcp`. `state` is optional; when sent it is returned unchanged, and clients should validate it and `iss`. Exchange the code at `/oauth/mcp/token` with the same resource, redirect URI and code verifier. Refresh rotates the credential. Replaying an already-rotated refresh token within the reuse grace period (default 30 seconds) while its successor is unused reissues a pair; any other reuse revokes the grant. Token endpoint database contention returns `503 temporarily_unavailable` with `Retry-After`, never `invalid_grant`.
6. POST MCP requests to `/mcp`. Revision 2026-07-28 clients send the protocol-version, method and name headers with per-request metadata and need no initialize handshake. Revision 2025-06-18 and 2025-11-25 clients, and 2025-03-26 clients best-effort, may `initialize` and send notifications; they are served statelessly. Clients that only speak the 2024-11-05 HTTP+SSE transport are not supported. Sessions (`Mcp-Session-Id`) are refused, and GET or DELETE on `/mcp` returns 405. Tasks and `subscriptions/listen` need 2026-07-28. Use the official SDK to encode requests.

An HTTPS ingress must preserve the configured public `Host`, including a non-standard port. `X-Forwarded-Host` does not establish authority. Browser `Origin` must match the configured origin, or be listed exactly under **Allowed browser origins** (Access policy, Advanced) for a browser-hosted client such as MCP Inspector; those origins get CORS on `/mcp` and the token, registration and revocation endpoints, never with credentials. The discovery documents allow any origin.

MCP has its own database pool of two connections per web process, from `DIRECT_DATABASE_URL` (or `DATABASE_URL`); capacity preflight includes it for every web replica. URLs marked `pgbouncer=true` are rejected. Query, lock and idle-transaction deadlines are five, one and five seconds. Retry mutations only with the same idempotency key and identical input.

Tokens belong in the client's secure credential store, never in tool arguments, logs, resource URIs or committed configuration. REST API keys and upstream SSO tokens are not MCP credentials.

## Calling tools

Call `whoami` first: it returns the user id, display name, role, teams, effective scopes, whether changes and sensitive reads are on, and the enabled tools. Use `assigneeId: "me"` for the caller's own incidents.

Use a named tool when one fits. Otherwise use `search_capabilities`, then `describe_operation`, then `read_operation` for reads or `call_operation` for routine changes. `call_operation` still serves reads in this release but adds a deprecation warning pointing to `read_operation`. Arguments contain named `path`, `query` and `body` objects from the OpenAPI contract. `query.limit` is 1 to 50; follow `data.pagination.nextCursor` for more. Routine changes need a stable `idempotencyKey`; retry with the identical operation, arguments and key, because a change can commit even when the response is lost.

Errors return structured content with `code`, an optional `domainCode` and `fields`, `retryable`, `retryAfterSeconds`, `hint` and `requestId` (the `X-Request-Id` header). A missing consent scope returns `MCP_SCOPE_NOT_GRANTED` naming the scope; a missing role permission returns `MCP_OPERATION_FORBIDDEN`.

## Reviewed configuration changes

With changes on, call `operation_prepare` with the operationId and its arguments (no `idempotencyKey`). Nothing changes yet. The result carries an approval id, a native `reviewUrl`, deadlines, `nextSteps` and `selfApprovable`. Share the `reviewUrl`; administrators are also notified in OpsKnight. Poll `operation_get_approval` until it reports `APPROVED`, then call `operation_commit_approved` with the approval id within the commit window. A rejection returns the reviewer's reason, labelled untrusted.

## Reviewed runbook runs

Consent to `runbooks:execute runbooks:read incidents:read services:read` and turn changes on. Call `runbook_prepare_execution` with `runbookId`, the native execute `body` (without `expectedPlanDigest`) and a stable `idempotencyKey`. No job starts. Someone with runbook approve permission (Responders and Administrators by default) opens the `reviewUrl`, inspects the frozen actions, target and digest, and approves or rejects; runbook approvers are notified in OpsKnight. Normally that is a second person; an administrator may approve their own request after ticking a confirmation. The MCP client can never submit an approval.

Poll `runbook_get_approval`, then call `runbook_execute_approved` with only `previewId` and a stable `idempotencyKey`, reusing both after a lost response. The preview waits for review for the policy's **Time to review** (default 240 minutes) and must be executed within **Time to apply after approval** (default 30 minutes). An expired, rejected or changed plan needs preparing and review again. Execution creates one native durable execution and returns its id, status and UI link. Step approvals and Agent controls still apply. A refreshed token may continue the same grant's pending approval while its current scopes and authority still suffice. See [approval boundaries](architecture.md#independently-reviewed-runbook-execution).

## Rollout and rollback

Existing installations keep automatic registration off after the additive migrations. Roll out to every replica before enabling it. Before rolling back to code that does not know dynamic-client policy, turn MCP off and revoke the dynamically registered clients (`McpClient.dynamicRegistration = true`, set `revokedAt`) while the new code is still available. Keep the additive columns.

Upgrading from the earlier `MCP_TOKEN_HASH_SECRET` implementation changes the credential key: existing tokens and codes stop validating and users reconnect. Administrators can revoke the old connections with **Revoke all active connections** under **Credential security** on the Connections tab.

Client compatibility is tracked in the [setup guide](../../guides/mcp/self-hosted-setup.md#client-compatibility): only Claude Code has a recorded live run, and no client is marked Verified until a full live client checkpoint is recorded. Agents without a browser use an OAuth refresh loop or a personal access token; see [API-hosted and headless agents](../../guides/mcp/api-agents.md). External issuers, client-credentials machine grants, stdio and MCP Apps are not implemented. Do not substitute REST tokens or disable resource validation to work around a client problem.
