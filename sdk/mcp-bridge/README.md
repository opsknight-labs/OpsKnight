# opsknight-mcp

A stdio MCP server that forwards to a self-hosted OpsKnight server's `/mcp` endpoint, for clients that only start local MCP servers or cannot sign in with remote OAuth. Node.js 20 or later, no dependencies, not published to a registry.

Full guide: [docs/v2.2.0/guides/mcp/stdio-bridge.md](../../docs/v2.2.0/guides/mcp/stdio-bridge.md).

```bash
# Personal access token (okmcp_pat_…)
OPSKNIGHT_TOKEN=okmcp_pat_… node bin/opsknight-mcp.js --url https://ops.your-company.com

# Or sign in once with a device code; the refresh token is kept in
# $XDG_CONFIG_HOME/opsknight/mcp.json (default ~/.config), mode 0600
node bin/opsknight-mcp.js login --url https://ops.your-company.com
node bin/opsknight-mcp.js --url https://ops.your-company.com
```

Claude Desktop (`claude_desktop_config.json`); the same `mcpServers` entry works in Cursor, Windsurf and Gemini CLI:

```json
{
  "mcpServers": {
    "opsknight": {
      "command": "node",
      "args": ["/path/to/mcp-bridge/bin/opsknight-mcp.js", "--url", "https://ops.your-company.com"],
      "env": { "OPSKNIGHT_TOKEN": "okmcp_pat_…" }
    }
  }
}
```

Options: `--toolsets a,b` (sends `X-OpsKnight-Toolsets`), `--channel` (Claude Code: push your new pages into the session), `login --scope "…" --client-id <id>`.

Plain `http://` is refused except for `localhost` and `127.0.0.1`. Tokens are never written to standard output or standard error.

Tests: `npx vitest run tests/mcp/stdio-bridge.test.ts` (fake server, part of `npm run test:mcp`) and `tests/integration/mcp-stdio-bridge.test.ts` (real route, part of `npm run test:mcp:db`). Type check: `npx tsc -p sdk/mcp-bridge/tsconfig.json`.
