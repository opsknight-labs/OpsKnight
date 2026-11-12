---
title: AI assistants (MCP)
order: 1
description: Connect Claude, ChatGPT, Cursor, VS Code and other MCP assistants to OpsKnight with per-person sign-in and reviewed changes.
type: concept
product_area: mcp
audience: [administrator, responder, developer]
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - src/app/(app)/settings/integrations/mcp/page.tsx
    - src/lib/mcp/docs-links.ts
---

# AI assistants (MCP)

OpsKnight includes a Model Context Protocol (MCP) server. Each person connects their own assistant, signs in with their OpsKnight account and approves what it may do. Assistants act with that person's current permissions, never more. Changes are off until an administrator allows them, and configuration changes and runbook runs wait for human review.

- [Self-hosted setup](self-hosted-setup.md): turn it on, connect assistants, manage connections, exposed capabilities, reviewed changes and client compatibility.
- [Client setup guides](clients/README.md): exact steps, limits and troubleshooting for Claude, Claude Code, ChatGPT, Cursor, VS Code, Codex CLI, Gemini CLI and Windsurf.
- [API-hosted and headless agents](api-agents.md): Anthropic and OpenAI API agents with an OAuth refresh loop, and personal access tokens for CI, n8n and other fixed-header clients.
- [stdio bridge](stdio-bridge.md): `opsknight-mcp`, a local stdio server for clients that cannot connect to a remote server or sign in with OAuth, with a personal token or device sign-in.
- [Troubleshooting](troubleshooting.md): every error code and server log event, with fixes. Generated from the code.
- [What to ask](what-to-ask.md): example requests by role, with the built-in prompt or tool and the permission each needs, and three annotated sessions.
- [Build an agent](build-an-agent.md): connect your own code with the MCP SDK, page through results, retry safely and drive the approval loop.
- [Security and data](security-and-data.md): what reaches the AI vendor, what is always removed, what OpsKnight stores and logs, and the controls.

Reference and operations:

- [Permissions reference](../../reference/mcp/permissions.md): every permission, which roles can use it, and the effective-access rule. Generated from the code.
- [Catalog and limits](../../reference/mcp/catalog.md): tools, operations, approvals, protocol features and fixed limits.
- [Tool reference](../../reference/mcp/tools.md): every tool and prompt, with its hints, scopes and inputs. Generated from the code.
- [Architecture and threat model](../../operate/mcp/architecture.md), [contributing to MCP](../../operate/mcp/contributing.md), [certification status](../../operate/mcp/certification.md), [exclusion review](../../operate/mcp/exclusion-review.md) and [full-parity delivery](../../operate/mcp/full-parity.md).
