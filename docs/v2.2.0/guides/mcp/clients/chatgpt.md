---
title: ChatGPT
order: 3
description: Add OpsKnight to ChatGPT as a custom MCP server plugin, including private installations through OpenAI Secure MCP Tunnel.
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

# ChatGPT

**Status: Expected.** These steps follow OpenAI's documentation; no end-to-end run of ChatGPT against OpsKnight is recorded. ChatGPT's OAuth profile (redirect `https://chatgpt.com/connector_platform_oauth_redirect`, `search`/`fetch` shape) passed the emulated [client matrix run](../../../operate/mcp/certification.md#client-matrix-run-8-november-2026).

Vendor documentation (fetched 12 November 2026): [Building MCP servers for ChatGPT and API integrations](https://developers.openai.com/api/docs/guides/custom-mcp-server) and [Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt).

## Before you start

- ChatGPT connects from OpenAI's cloud. OpsKnight must be reachable over public HTTPS with a trusted certificate, or through [OpenAI Secure MCP Tunnel](../self-hosted-setup.md#private-installation-openai-secure-mcp-tunnel) for a private installation.
- Plan and workspace rules change often and OpenAI's help center could not be fetched for this guide. Which plans may add custom MCP servers, and whether write tools are allowed on yours, is decided by OpenAI and your workspace administrator; check the vendor pages above.

## Connect with OAuth

1. Open `chatgpt.com/plugins`, select **+**, then **Add custom MCP server**.
2. Name it `OpsKnight`. Under the connection, paste `https://ops.your-company.com/mcp`, or choose your Secure MCP Tunnel.
3. Choose **OAuth**. ChatGPT identifies itself with a metadata document or registers itself, which OpsKnight's **Automatic connections** accepts. If automatic connections are off, an administrator registers a manual client with redirect URI `https://chatgpt.com/connector_platform_oauth_redirect` and you enter its client ID.
4. Accept the warning, select **Create** as a plugin, install it, then sign in to OpsKnight and approve.

## Personal access token

Not available: OpenAI's pages document OAuth and no-authentication only, with no custom request headers. Use OAuth.

## Known limits

- ChatGPT treats every tool without `readOnlyHint` as a write action and asks for confirmation by default. OpsKnight marks its read tools read-only.
- Company knowledge and deep research call only `search` and `fetch`. OpsKnight serves both (on by default under **Exposed capabilities**).
- ChatGPT reads only the first 512 characters of server instructions reliably; OpsKnight's instructions fit.
- The tool list is a snapshot: after an administrator changes exposed capabilities, open the connection, select **Refresh**, and start a new conversation. In a workspace, an administrator may need to republish it.
- OpenAI documents no tool-count or result-size cap. OpsKnight lists at most 54 tools.

## Troubleshooting

- Expand a tool call in the conversation to see the request and response JSON, including OpsKnight's error code.
- Check the endpoint from outside with `npm run mcp:doctor -- https://ops.your-company.com/mcp`, or with MCP Inspector (`npx @modelcontextprotocol/inspector@latest`).
- With a tunnel, check the tunnel client's status first.
- If ChatGPT asks you to sign in again every few days, its stored authorization expired; reconnect.
