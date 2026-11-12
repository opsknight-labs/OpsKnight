---
title: stdio bridge for local MCP clients
order: 6
description: Connect clients that only run local stdio MCP servers, or cannot do remote OAuth, to a self-hosted OpsKnight with the opsknight-mcp bridge.
type: how-to
product_area: mcp
audience: [responder, developer]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - sdk/mcp-bridge/bin/opsknight-mcp.js
    - sdk/mcp-bridge/src/bridge.js
    - sdk/mcp-bridge/src/auth.js
    - tests/mcp/stdio-bridge.test.ts
    - tests/integration/mcp-stdio-bridge.test.ts
---

# stdio bridge for local MCP clients

Some MCP clients only start local servers over standard input and output (stdio), or cannot complete a remote OAuth sign-in. `opsknight-mcp` is a small local program that such a client starts like any other stdio server. It forwards each message to your OpsKnight server's `/mcp` endpoint and writes the answers back. It has no dependencies beyond Node.js 20 or later, keeps no session and adds no permissions: every call runs as you, within your token's permissions, exactly as a remote connection would.

Clients that can connect to a remote server with OAuth should do that instead; see [self-hosted setup](self-hosted-setup.md#users-connect-and-sign-in).

## Get the bridge

The bridge is not published to a package registry. It lives in the OpsKnight repository under `sdk/mcp-bridge`. Copy that folder to the machine that runs your MCP client and run `node <folder>/bin/opsknight-mcp.js`, or link it once with `npm link` from inside the folder to get an `opsknight-mcp` command.

The bridge refuses plain `http://` addresses except `localhost` and `127.0.0.1`, so your token never crosses a network unencrypted.

## Sign in

Choose one:

- **Personal access token** (an administrator must allow personal tokens). Create one under **Settings → Integrations & ChatOps → MCP → Connections → Personal access tokens** and give it to the bridge in the `OPSKNIGHT_TOKEN` environment variable. Tokens start with `okmcp_pat_`. See [API-hosted and headless agents](api-agents.md).
- **Device sign-in** (an administrator must turn on **Device sign-in**, and either **Automatic connections** or register the client by hand). Run once:

  ```bash
  opsknight-mcp login --url https://ops.your-company.com
  ```

  The bridge registers itself as "OpsKnight stdio bridge" (or uses `--client-id <id>` for an assistant an administrator registered with **Allow device sign-in with a code**), prints a code and an address, and waits while you approve in any browser ([how device sign-in works](self-hosted-setup.md#sign-in-from-a-cli-or-server-device-code)). Add `--scope "incidents:read services:read"` to ask for fewer permissions. It stores the client id and refresh token in `$XDG_CONFIG_HOME/opsknight/mcp.json` (default `~/.config/opsknight/mcp.json`), readable only by you (mode 0600). Access tokens are kept only in memory and refreshed before they expire. Revoking the connection under **Your connections** signs the bridge out.

`OPSKNIGHT_TOKEN` wins when both are present. The bridge never prints a token; it writes diagnostics to standard error only.

## Configure your client

The command is the same for every stdio client: `opsknight-mcp --url <App URL>`, with `OPSKNIGHT_TOKEN` in the environment if you use a personal token. If `opsknight-mcp` is not on the client's `PATH`, use `node` as the command and the full path to `bin/opsknight-mcp.js` as the first argument.

Claude Desktop (`claude_desktop_config.json`, under **Settings → Developer → Edit Config**):

```json
{
  "mcpServers": {
    "opsknight": {
      "command": "opsknight-mcp",
      "args": ["--url", "https://ops.your-company.com"],
      "env": { "OPSKNIGHT_TOKEN": "okmcp_pat_…" }
    }
  }
}
```

Leave out `env` after `opsknight-mcp login`. The same `mcpServers` entry works in Cursor (`~/.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`) and Gemini CLI (`~/.gemini/settings.json`). VS Code (`.vscode/mcp.json`) uses `"servers"` with `"type": "stdio"`:

```json
{
  "servers": {
    "opsknight": {
      "type": "stdio",
      "command": "opsknight-mcp",
      "args": ["--url", "https://ops.your-company.com"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add opsknight -- opsknight-mcp --url https://ops.your-company.com
```

Codex CLI:

```bash
codex mcp add opsknight -- opsknight-mcp --url https://ops.your-company.com
```

Keep a personal token in the client's own secret store or environment where it has one, not in a shared or committed file.

## Options

| Option            | Meaning                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--url <App URL>` | Your OpsKnight address (or `OPSKNIGHT_URL`). A trailing `/mcp` is accepted.                                      |
| `--toolsets a,b`  | Sends `X-OpsKnight-Toolsets: a,b` so the server offers only those groups of tools, where the server supports it. |
| `--channel`       | Claude Code only: pushes your new pages into the running session. See below.                                     |
| `login`           | Device sign-in, as above. Takes `--url`, and optionally `--scope` and `--client-id`.                             |

## What the bridge does

- Each line the client writes is one HTTP `POST <App URL>/mcp` with your bearer token and the protocol headers the server expects: `MCP-Protocol-Version` (the version in the request's `_meta`, otherwise the one agreed in `initialize`), `Mcp-Method`, and `Mcp-Name` for tool calls, prompts, resource reads and tasks.
- JSON answers and streamed (`text/event-stream`) answers are both written back, one message per line. Several requests can run at once; each answer keeps its request's id.
- **401**: with a device sign-in the bridge refreshes once and retries; otherwise the client gets a JSON-RPC error telling you to sign in again or replace the token.
- **429**: the bridge waits for `Retry-After` (up to 30 seconds, three times) and retries; a longer wait is returned as an error.
- If the server cannot be reached, the request gets a JSON-RPC error and the bridge keeps running.

## Pages in Claude Code (channel)

Claude Code [channels](https://code.claude.com/docs/en/channels) let a local MCP server push events into a running session. With `--channel`, the bridge declares the `claude/channel` capability, holds a `subscriptions/listen` stream for `opsknight://oncall/me/pages` and turns each update into a `notifications/claude/channel` event, so Claude learns that you were paged and can look with `oncall_catch_up`. The server ends each stream after ten minutes; the bridge reconnects, and backs off when the subscription is refused (for example on a server version without that resource).

Channels are a Claude Code research preview: start Claude Code with the channel enabled, for example `claude --dangerously-load-development-channels server:opsknight`, and on Team and Enterprise plans an administrator must allow channels. Only events from your own OpsKnight account arrive; the bridge does not relay permission prompts.

## Troubleshooting

- `Refusing http://…`: use the `https://` address.
- `No credentials for …`: set `OPSKNIGHT_TOKEN` or run `opsknight-mcp login`.
- `Device sign-in is turned off on this server`: ask an administrator, or use a personal token.
- Error codes the server returns are listed in [troubleshooting](troubleshooting.md).
