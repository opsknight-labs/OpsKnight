---
title: Cursor
order: 4
description: Connect Cursor to OpsKnight with the Add to Cursor link, mcp.json and OAuth, or a personal access token header.
type: how-to
product_area: mcp
audience: [responder, developer]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - src/components/settings/mcp/setup-commands.ts
    - src/lib/mcp/auth/redirect-uri.ts
---

# Cursor

**Status: Expected.** These steps follow Cursor's documentation; no end-to-end run of Cursor against OpsKnight is recorded. Cursor's OAuth profile passed the emulated [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026).

Vendor documentation: [Model Context Protocol (MCP)](https://cursor.com/docs/context/mcp) (fetched 12 November 2026).

## Before you begin

- An administrator has turned on AI assistant access in **Settings → Integrations & ChatOps → MCP (AI Assistants)** (see [MCP setup](../self-hosted-setup.md)).
- Copy the **MCP server URL** from the **Connect** tab on that page; the examples below use `https://ops.your-company.com/mcp`.
- You have your own OpsKnight account and Cursor installed.

## Connect with OAuth (recommended)

1. Use **Add to Cursor** on OpsKnight's **Connect** tab, or add the entry to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), merging it with any servers already there:

   ```json
   {
     "mcpServers": {
       "opsknight": { "url": "https://ops.your-company.com/mcp" }
     }
   }
   ```

2. Cursor discovers OpsKnight's authorization server, registers itself and opens the browser. Sign in to OpsKnight and approve the connection.

Cursor uses refresh tokens, so you sign in again only when the connection ends.

If **Automatic connections** is off, an administrator registers a manual client with Cursor's redirect URIs `https://www.cursor.com/agents/mcp/oauth/callback` and `http://localhost:8787/callback`, and you add `"auth": { "CLIENT_ID": "<client id>" }` to the entry.

## Personal access token (alternative)

```json
{
  "mcpServers": {
    "opsknight": {
      "url": "https://ops.your-company.com/mcp",
      "headers": { "Authorization": "Bearer ${env:OPSKNIGHT_TOKEN}" }
    }
  }
}
```

`${env:NAME}` reads an environment variable visible to Cursor. Do not paste the token itself into a project file that is committed.

## Verify the connection

1. Ask Cursor "Who am I in OpsKnight, and what can you do for me?". It calls `whoami` and answers with your role, teams and enabled tools.
2. In OpsKnight, select **Check connection** on the **Connect** tab to see the connection you just made.

## Known limits

- Cursor's current page documents no tool-count cap or result-size limit. Older Cursor versions capped active tools at about 40; if some OpsKnight tools are missing, disable tools you do not need in Cursor's MCP settings, or ask an administrator to turn off unused capabilities. OpsKnight lists 17 to 54 tools depending on permissions.

## Troubleshooting

- Open the Output panel (Cmd+Shift+U / Ctrl+Shift+U) and choose **MCP Logs**.
- Toggle the server off and on in Cursor's MCP settings to reconnect and refetch tools.
- `MCP_CLIENT_UNKNOWN` after an OpsKnight reinstall: remove the entry, add it again and sign in.
