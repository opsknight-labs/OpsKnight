---
title: VS Code (GitHub Copilot)
order: 5
description: Connect GitHub Copilot in VS Code to OpsKnight with OAuth or a personal access token entered as a secret input.
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

# VS Code (GitHub Copilot)

**Status: Expected.** These steps follow the VS Code documentation; no end-to-end run of VS Code against OpsKnight is recorded. The VS Code and VS Code for the web OAuth profiles passed the emulated [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026).

Vendor documentation (fetched 12 November 2026): [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration), [Manage MCP servers](https://code.visualstudio.com/docs/agents/run/manage-mcp-servers) and [Tools](https://code.visualstudio.com/docs/agents/run/tools).

## Connect with OAuth (recommended)

Use **Add to VS Code** on OpsKnight's **Connect** tab; or on macOS and Linux:

```bash
code --add-mcp '{"name":"opsknight","type":"http","url":"https://ops.your-company.com/mcp"}'
```

Or run **MCP: Add Server** from the Command Palette, or add to `.vscode/mcp.json` (one workspace) or your user `mcp.json`:

```json
{
  "servers": {
    "opsknight": { "type": "http", "url": "https://ops.your-company.com/mcp" }
  }
}
```

On first use VS Code opens the browser to sign in to OpsKnight; select **Authenticate** if it asks. If **Automatic connections** is off, an administrator registers a manual client with VS Code's loopback redirect (`http://127.0.0.1:33418/`) and you add `"oauth": { "clientId": "<client id>" }` to the entry.

## Personal access token (alternative)

Let VS Code prompt for the token once and keep it in its secret storage:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "opsknight-token",
      "description": "OpsKnight personal access token",
      "password": true
    }
  ],
  "servers": {
    "opsknight": {
      "type": "http",
      "url": "https://ops.your-company.com/mcp",
      "headers": { "Authorization": "Bearer ${input:opsknight-token}" }
    }
  }
}
```

`${env:NAME}` also works in editor-managed files. The newer portable Copilot file (`~/.copilot/mcp-config.json`) uses `${NAME}` instead and does not support `inputs`.

## Known limits

- A chat request can have at most **128 tools** enabled ("Cannot have more than 128 tools per request"). OpsKnight lists at most 54, so it fits unless many other servers are on. The `github.copilot.chat.virtualTools.threshold` setting groups tools when the total is large.
- VS Code tries Streamable HTTP first and falls back to SSE; OpsKnight answers on Streamable HTTP.
- No result-size limit is documented.

## Troubleshooting

- **MCP: List Servers**, select `opsknight`, then **Show Output** for the server log.
- **MCP: Restart Server** after a policy change; **MCP: Reset Trust** if VS Code stopped trusting the server.
- VS Code can also discover servers configured in Claude Desktop, Cursor and Windsurf; remove duplicates if OpsKnight appears twice.
