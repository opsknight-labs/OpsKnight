---
title: Claude apps (claude.ai, Desktop, mobile)
order: 1
description: Add OpsKnight as a custom connector in Claude on the web, Claude Desktop and the mobile apps.
type: how-to
product_area: mcp
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - src/components/settings/mcp/setup-commands.ts
    - src/lib/mcp/auth/registration.ts
---

# Claude apps (claude.ai, Desktop, mobile)

**Status: Expected.** These steps follow Anthropic's documentation; no end-to-end run of the Claude apps against OpsKnight is recorded. The OAuth profile Claude uses (redirect `https://claude.ai/api/mcp/auth_callback`) passed the emulated [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026).

Vendor documentation: [Getting started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) (fetched 12 November 2026).

## Before you start

- Claude connects from Anthropic's cloud, not from your computer. OpsKnight must be reachable from the internet at its App URL with a publicly trusted certificate. A private installation must allow Anthropic's published IP ranges (linked from the vendor page).
- Connectors you add on claude.ai also appear in Claude Desktop and the mobile apps. Claude Desktop's `claude_desktop_config.json` is only for local (stdio) servers, so do not add OpsKnight there.
- Plans: custom connectors are available on Free (one custom connector), Pro, Max, Team and Enterprise. On Team and Enterprise only an Owner or Primary Owner can add one for the organization.

## Connect with OAuth (recommended)

Individual plans:

1. In Claude, open **Customize → Connectors**, select **+ Add**, then **Add custom connector**.
2. Name it `OpsKnight` and paste your MCP server URL, for example `https://ops.your-company.com/mcp`. Select **Continue**.
3. Under **Authentication**, choose **Sign in now** (or **Sign in when needed**). Leave the OAuth client on **Use Claude's published identity (Recommended)** or **Register automatically**; both work with OpsKnight's automatic connections.
4. Sign in to OpsKnight in the window that opens and approve the permissions.

Team and Enterprise: an owner adds it under **Organization settings → Connectors → Custom → Web** with the same URL. Each member then selects **Connect** and signs in as themselves, so every member acts with their own OpsKnight permissions.

If **Automatic connections** is off in OpsKnight, an administrator first registers a manual client with redirect URI `https://claude.ai/api/mcp/auth_callback` and you choose **Use your own OAuth client** with its client ID.

## Personal access token (alternative)

The connector form has **Request headers** for "an API key, bearer token, or other fixed credential instead of OAuth". Add `Authorization` with the value `Bearer okmcp_pat_…`.

On Team and Enterprise that header is **shared by every member**, so every call would act as the one person who created the token. Use OAuth there. To change a header you must remove the connector and add it again.

## Known limits

- Anthropic's page does not document a tool-count cap or a result-size limit. OpsKnight lists at most 54 tools.
- Claude's Advanced Research cannot call local MCP tools; a remote connector such as OpsKnight is unaffected.
- Whatever the client asks before a call, OpsKnight still sends configuration changes to its own review page.

## Troubleshooting

- **The connector cannot reach the server:** check the URL from outside your network with `npm run mcp:doctor -- https://ops.your-company.com/mcp`. A firewall that only admits your office will block Claude.
- **Sign-in loops or fails with `MCP_CLIENT_UNKNOWN`:** remove the connector and add it again so Claude registers afresh.
- **Tools missing after an administrator changed exposed capabilities:** disconnect and connect again; Claude caches the tool list.
- Anthropic's page does not document client-side logs for connectors.
