---
title: API-hosted and headless agents
order: 4
description: Connect agents that run without a browser (Anthropic and OpenAI API agents, CI jobs, workflow tools) with an OAuth refresh loop or a personal access token.
type: how-to
product_area: mcp
audience: [developer, administrator]
verification:
  level: source
  verified_at: 2026-11-09
  evidence:
    - src/lib/mcp/auth/personal-tokens.ts
    - src/lib/mcp/auth/principal.ts
    - src/lib/mcp/auth/effective-access.ts
    - src/lib/mcp/auth/oauth-model.ts
    - src/app/(app)/settings/integrations/mcp/actions.ts
---

# API-hosted and headless agents

Desktop assistants sign in through the browser and refresh their own tokens. An agent that runs on a provider's API, in CI or in a workflow tool has no browser. It can connect in one of two ways:

- **OAuth with a refresh loop.** One interactive sign-in, after which the agent platform refreshes the token itself. It needs no administrator setting beyond MCP being on, and works anywhere a platform stores an OAuth refresh token.
- **A personal access token.** A long-lived bearer secret for clients that can only send a fixed header. Personal tokens are off until an administrator allows them.

Both act as one person, with that person's current permissions. Neither can approve its own changes.

## Before you start

- The server must be reachable from the agent platform at a public HTTPS address with a publicly trusted certificate (see [Self-hosted setup](self-hosted-setup.md#reverse-proxies-and-private-installations)). An API-hosted agent connects from the provider's network, not from your laptop.
- The MCP address is `<origin>/mcp`, where `<origin>` is your OpsKnight App URL.

## Option 1: OAuth with a refresh loop

Access tokens last **300 seconds**. Passing a raw access token to an API as a static bearer works for five minutes and then fails with `MCP_INVALID_TOKEN`. Give the platform the refresh token instead, so it can renew the access token on its own.

1. An administrator registers a manual client under **Settings → Integrations & ChatOps → MCP → Assistants** with a loopback redirect URI, for example `http://127.0.0.1:8765/callback`. It is a public client (`token_endpoint_auth_method: none`); there is no client secret.
2. Do one interactive authorization-code exchange with PKCE (S256) and `resource=<origin>/mcp`, as in the [manual development setup](../../operate/mcp/contributing.md#manual-development-setup). Sign in as the person the agent acts for and approve only what it needs. Tick **View only** if the agent should never change anything.
3. Store the refresh token, the client_id and the token endpoint `<origin>/oauth/mcp/token` in the platform's credential store. Do not store the access token.
4. Before each run (or when a call returns 401), exchange the refresh token for a new access token with `grant_type=refresh_token`, `client_id` and `resource`.

Refresh **rotates** the token: every refresh returns a new refresh token, and the old one stops working. Reusing an old refresh token after the reuse grace period (30 seconds; fixed, with no setting in the administration UI), or after its successor was used, is treated as theft and revokes the whole connection. Concurrent workers must not share one refresh token: give each worker its own connection, or serialise refreshes through one place.

Provider notes (follow the provider's own documentation for request fields and any beta headers):

- **Anthropic Messages API (`mcp_servers`).** Send the current access token as the server's authorization token, and refresh it before each request with the loop above. Managed agent credential vaults that support MCP OAuth can hold the refresh token, client_id and token endpoint and refresh for you.
- **OpenAI Responses API (MCP tool).** Send the current access token in the tool's `authorization` field and refresh it the same way.

Keep the platform's tool-approval setting on for `operation_prepare`, `operation_commit_approved` and the runbook tools, so a person sees each change request before the agent sends it. OpsKnight still requires its own review for those changes.

## Option 2: a personal access token

Use a personal token for clients that send a fixed header and cannot refresh, such as GitHub Copilot coding agent MCP configuration, n8n or a CI job.

An administrator first allows them under **Access policy → Personal access tokens**, and chooses:

- the longest expiry (default 30 days, at most 90),
- the permissions a token may carry (by default viewing incidents, services and schedules).

One person can hold at most 20 active personal tokens.

Then the person the agent acts for creates one under **Connections → Personal access tokens**. Creating a token needs a sign-in within the last two hours. Choose a name, the permissions and an expiry. The token starts with `okmcp_pat_` so secret scanners can find it, and it is **shown once**: copy it straight into the platform's secret store. OpsKnight stores only a keyed digest.

Send it on every request:

```http
POST /mcp
Authorization: Bearer okmcp_pat_…
Content-Type: application/json
```

Recipes:

- **GitHub Copilot coding agent.** Store the token as a repository secret whose name starts with `COPILOT_MCP_`, and reference it in the MCP server's `headers` as `Authorization: Bearer $COPILOT_MCP_OPSKNIGHT_TOKEN`.
- **n8n.** Use the MCP Client node with header authentication: name `Authorization`, value `Bearer <token>`.
- **CI jobs.** Store the token as a masked secret and pass it as an `Authorization` header to your MCP client; never echo it in logs.

What a personal token can and cannot do:

- It acts as its owner. Role and team changes apply on the next request, and security events (password change, sign-out everywhere, deactivation) end it, as for any connection.
- Its permissions are capped live by the access policy: narrowing the allowed list, or turning on **Require view-only connections**, takes effect on the next request.
- It never carries `runbooks:execute`, so it cannot request runbook runs.
- Changes it prepares always need a second person to approve them, even when its owner is an administrator.
- It is never renewed. The owner is reminded in OpsKnight seven days before it expires (halfway through, for a token of a week or less); create a new token and update the agent before then.
- It is listed under **Connections** with a **Personal token** badge, its expiry and its last call, and can be revoked there. **Revoke all active connections** includes personal tokens.
- Turning personal tokens off in the access policy revokes every token immediately. Turning them back on does not restore them.

Prefer OAuth with a refresh loop wherever the platform supports it: its access tokens expire in minutes, and a leaked refresh token is detected on reuse.

## View-only connections

To keep an agent read-only, tick **View only** on the consent page, or give a personal token only view permissions. An administrator can require this for everyone with **Access policy → View-only connections → Require view-only connections**; every connection, OAuth and personal, is then capped to view permissions until the switch is turned off. A view-only session is not offered `call_operation` or `operation_prepare`.
