---
title: Claude Code
order: 2
description: Connect the Claude Code CLI to OpsKnight with OAuth or a personal access token header.
type: how-to
product_area: mcp
audience: [responder, developer]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - src/components/settings/mcp/setup-commands.ts
    - src/lib/mcp/auth/personal-tokens.ts
---

# Claude Code

**Status: Tested.** Registration, consent, tools, scoped reads, role changes and deactivation were checked against a live deployment, and Claude Code CLI 2.1.316 passed the [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026). The personal-token header path below is Expected (not recorded).

Vendor documentation: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp) (fetched 12 November 2026).

## Before you begin

- An administrator has turned on AI assistant access in **Settings → Integrations & ChatOps → MCP (AI Assistants)** (see [MCP setup](../self-hosted-setup.md)).
- Copy the **MCP server URL** from the **Connect** tab on that page; the examples below use `https://ops.your-company.com/mcp`.
- You have your own OpsKnight account and the Claude Code CLI installed.

## Connect with OAuth (recommended)

1. Add the server:

   ```bash
   claude mcp add --scope user --transport http opsknight 'https://ops.your-company.com/mcp'
   ```

2. Inside Claude Code run `/mcp`, select `opsknight` and sign in in the browser. From a shell, `claude mcp login opsknight` does the same.
3. Approve the connection on the OpsKnight consent page.

`--scope user` makes it available in every project. `--scope project` writes `.mcp.json` in the repository for the team; each person still signs in as themselves.

## Personal access token (alternative)

```bash
export OPSKNIGHT_TOKEN='okmcp_pat_…'
claude mcp add --scope user --transport http opsknight 'https://ops.your-company.com/mcp' \
  --header 'Authorization: Bearer ${OPSKNIGHT_TOKEN}'
```

Or in `.mcp.json`:

```json
{
  "mcpServers": {
    "opsknight": {
      "type": "http",
      "url": "https://ops.your-company.com/mcp",
      "headers": { "Authorization": "Bearer ${OPSKNIGHT_TOKEN}" }
    }
  }
}
```

Claude Code expands `${VAR}` and `${VAR:-default}`. An unset variable without a default is sent literally and `claude mcp list` warns about it; an empty one is sent empty. Keep the token in the environment, not in a committed file.

## Verify the connection

1. Run `claude mcp list`; `opsknight` shows **Connected**.
2. Ask Claude Code "Who am I in OpsKnight, and what can you do for me?". It calls `whoami` and answers with your role, teams and enabled tools.
3. In OpsKnight, select **Check connection** on the **Connect** tab to see the connection you just made.

## Known limits

- Tool output is capped at 25,000 tokens by default (`MAX_MCP_OUTPUT_TOKENS`), with a warning above 10,000. OpsKnight pages results (`query.limit` 1 to 50), so ask for smaller pages if you hit it.
- `MCP_TIMEOUT` sets the startup timeout in milliseconds.
- No tool-count cap is documented. OpsKnight lists at most 54 tools.
- When the same server name exists in several scopes, local wins over project, then user; settings are not merged.

## Troubleshooting

- `claude mcp list` shows **Connected**, **Needs authentication** or **Failed to connect**.
- **Needs authentication:** run `/mcp` and sign in again. **Clear authentication** in `/mcp` (or `claude mcp logout opsknight`) forgets the sign-in.
- Debug log: `claude --debug-file /tmp/claude-debug.log`, then look for the `opsknight` server lines.
- `MCP_INVALID_TOKEN` with a personal token: the token expired or was revoked, or the variable did not expand.
