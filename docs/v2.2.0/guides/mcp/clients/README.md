---
title: Client setup guides
order: 2
description: Per-assistant steps for connecting Claude, Claude Code, ChatGPT, Cursor, VS Code, Codex CLI, Gemini CLI and Windsurf to a self-hosted OpsKnight.
type: how-to
product_area: mcp
audience: [responder, administrator, developer]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - src/components/settings/mcp/setup-commands.ts
    - src/lib/mcp/auth/personal-tokens.ts
    - src/app/llms.txt/route.ts
---

# Client setup guides

Each guide gives the exact steps for one assistant, its documented limits and what to check when it fails. They are written from each vendor's official documentation, fetched on 12 November 2026 and linked at the top of each page. Vendors move menus often; when a step does not match what you see, follow the linked vendor page.

| Assistant                           | Guide                         | Status                                                              |
| ----------------------------------- | ----------------------------- | ------------------------------------------------------------------- |
| Claude (claude.ai, Desktop, mobile) | [Claude apps](claude-apps.md) | Expected                                                            |
| Claude Code                         | [Claude Code](claude-code.md) | Tested (see [certification](../../../operate/mcp/certification.md)) |
| ChatGPT                             | [ChatGPT](chatgpt.md)         | Expected                                                            |
| Cursor                              | [Cursor](cursor.md)           | Expected                                                            |
| VS Code with GitHub Copilot         | [VS Code](vscode.md)          | Expected                                                            |
| OpenAI Codex CLI                    | [Codex CLI](codex-cli.md)     | Expected                                                            |
| Gemini CLI                          | [Gemini CLI](gemini-cli.md)   | Expected                                                            |
| Windsurf (Devin Desktop)            | [Windsurf](windsurf.md)       | Expected                                                            |

**Expected** means the steps follow the vendor's documentation and OpsKnight implements what that documentation requires, but nobody has recorded an end-to-end run of that application against OpsKnight. **Tested** links the recorded run.

## What every guide assumes

- **The address.** Your MCP server URL is `<App URL>/mcp`, for example `https://ops.your-company.com/mcp`. Copy it from **Settings → Integrations & ChatOps → MCP → Connect**. Any installation also describes itself at `<App URL>/llms.txt`.
- **MCP is on.** An administrator turned it on ([self-hosted setup](../self-hosted-setup.md#administrator-turn-it-on-about-two-minutes)). With **Automatic connections** on, assistants register themselves; otherwise an administrator registers a manual client with the assistant's redirect URI first.
- **Sign-in is OAuth by default.** The assistant opens your browser, you sign in to OpsKnight and approve the permissions. Access tokens last five minutes and the assistant refreshes them itself.
- **A personal access token is the alternative** for clients that can send a fixed `Authorization` header and for agents without a browser. An administrator must allow personal tokens first; you then create one under **Connections → Personal access tokens**. It starts with `okmcp_pat_`, is shown once, and changes it prepares always need a second person to approve. Keep it in an environment variable or the client's secret store, never in a file you commit. See [API-hosted and headless agents](../api-agents.md#option-2-a-personal-access-token).
- **Tool count.** OpsKnight lists between 17 tools (view-only permissions) and 54 tools (an administrator who allowed changes). That is below every cap documented by the clients here; a client with a lower cap can hide some tools, and turning off unused capabilities under **Exposed capabilities** lowers the count.

## Troubleshooting that applies to every client

- **Check connection** on the Connect tab shows the connection you just made, or what to do next.
- `npm run mcp:doctor -- https://ops.your-company.com/mcp` (from a checkout of OpsKnight) checks discovery, TLS, automatic registration and the 401 challenge from outside, without creating credentials.
- A cloud-hosted assistant (Claude apps, ChatGPT) connects from the vendor's network: the server must be reachable from the internet with a publicly trusted certificate.
- Every error code an assistant can show is on the [troubleshooting page](../troubleshooting.md).
