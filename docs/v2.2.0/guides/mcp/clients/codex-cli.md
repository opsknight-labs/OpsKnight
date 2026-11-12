---
title: OpenAI Codex CLI
order: 6
description: Connect the Codex CLI to OpsKnight with codex mcp login or a personal access token from an environment variable.
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

# OpenAI Codex CLI

**Status: Expected.** These steps follow OpenAI's Codex documentation; no end-to-end run of the Codex CLI against OpsKnight is recorded. Its loopback OAuth profile passed the emulated [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026).

Vendor documentation (fetched 12 November 2026): [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) (formerly under developers.openai.com/codex).

## Connect with OAuth (recommended)

```bash
codex mcp add opsknight --url 'https://ops.your-company.com/mcp'
codex mcp login opsknight
```

`codex mcp login` opens the browser; on a machine without one, add `--no-browser` and open the printed link elsewhere. Codex asks for the scopes OpsKnight's 401 challenge suggests unless you pass `--scopes`.

This writes to `~/.codex/config.toml`:

```toml
[mcp_servers.opsknight]
url = "https://ops.your-company.com/mcp"
```

If **Automatic connections** is off, an administrator registers a manual client with a loopback redirect, and you add `--oauth-client-id <client id>` to `codex mcp add` (and, if the redirect has a fixed port, `callback_port` under `[mcp_servers.opsknight.oauth]`).

## Personal access token (alternative)

```toml
[mcp_servers.opsknight]
url = "https://ops.your-company.com/mcp"
bearer_token_env_var = "OPSKNIGHT_TOKEN"
```

Codex sends `Authorization: Bearer $OPSKNIGHT_TOKEN`. Export the variable in the shell that starts Codex.

## Known limits

- `startup_timeout_sec` (default 10) and `tool_timeout_sec` (default 60) per server.
- Tool output is limited by `tool_output_token_limit`, or per tool with `mcp_servers.opsknight.tools.<tool>.output_token_limit`. Ask for smaller pages if a result is cut.
- `enabled_tools` / `disabled_tools` narrow what Codex sees. No tool-count cap is documented; OpsKnight lists at most 54 tools.
- Older Codex releases needed an experimental flag for remote HTTP servers; the current documentation no longer mentions one. Update Codex if `url` is rejected.

## Troubleshooting

- `codex mcp list` and `/mcp` in the TUI show each server's state.
- Logs are under `log_dir`, by default `~/.codex/log`.
- `MCP_INVALID_TOKEN`: run `codex mcp login opsknight` again, or check that the token variable is set.
