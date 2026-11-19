---
title: Gemini CLI
order: 7
description: Connect Gemini CLI to OpsKnight over Streamable HTTP with /mcp auth or a personal access token header.
type: how-to
product_area: mcp
audience: [responder, developer]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - src/components/settings/mcp/setup-commands.ts
    - src/lib/mcp/auth/discovery-policy.ts
---

# Gemini CLI

**Status: Expected.** These steps follow the Gemini CLI documentation; no end-to-end run of Gemini CLI against OpsKnight is recorded. Its OAuth profile (empty `scope`, redirect on `localhost:7777`) passed the emulated [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026).

Vendor documentation: [MCP servers with the Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) (fetched 12 November 2026). That page notes that Gemini CLI was replaced by Antigravity CLI for unpaid-tier and Google One users on 18 June 2026; these steps apply where Gemini CLI is still in use.

## Connect with OAuth (recommended)

```bash
gemini mcp add --transport http opsknight 'https://ops.your-company.com/mcp'
```

Or in `~/.gemini/settings.json` (all projects) or `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "opsknight": { "httpUrl": "https://ops.your-company.com/mcp" }
  }
}
```

Use `httpUrl`, not `url`: `url` selects the older SSE transport. Then, inside Gemini CLI, run `/mcp auth opsknight`. Gemini CLI discovers OpsKnight's authorization server from the 401 answer and registers itself; it needs a local browser and does not work headless. Tokens are stored in `~/.gemini/mcp-oauth-tokens.json`.

If **Automatic connections** is off, an administrator registers a manual client and you add `"oauth": { "enabled": true, "clientId": "<client id>" }`.

## Personal access token (alternative)

```json
{
  "mcpServers": {
    "opsknight": {
      "httpUrl": "https://ops.your-company.com/mcp",
      "headers": { "Authorization": "Bearer okmcp_pat_…" }
    }
  }
}
```

The vendor page documents `$VAR` expansion for the `env` block but does not say whether it applies to `headers`, so this example uses the literal token. Keep that file private (it is in your home directory, not the project).

## Known limits

- Request timeout defaults to 600,000 ms (`timeout`).
- `includeTools` / `excludeTools` narrow the tool list (exclude wins). Tool names over 63 characters are truncated; OpsKnight's are shorter.
- No tool-count or result-size cap is documented. OpsKnight lists at most 54 tools.
- Avoid underscores in the server name: Gemini CLI's policy parser splits on them.

## Troubleshooting

- `/mcp list` (or `gemini mcp list`) shows the state; `/mcp auth` lists servers that need a sign-in.
- Start with `gemini --debug`, or press F12 for the debug console.
- An untrusted project folder disables its servers; run `gemini trust` there.
