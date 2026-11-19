---
title: Windsurf (Devin Desktop)
order: 8
description: Connect Windsurf's Cascade agent (now Devin Desktop) to OpsKnight with OAuth or a personal access token header.
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

# Windsurf (Devin Desktop)

**Status: Expected.** These steps follow the vendor documentation; no end-to-end run of Windsurf against OpsKnight is recorded.

Vendor documentation (fetched 12 November 2026): [Cascade MCP](https://docs.devin.ai/windsurf/plugins/cascade/mcp) (docs.windsurf.com now redirects there) and [Devin Desktop MCP](https://docs.devin.ai/desktop/cascade/mcp). Windsurf has been renamed Devin Desktop; the vendor pages disagree on the configuration path, so both are listed below.

## Connect with OAuth (recommended)

Add OpsKnight to the MCP configuration file and press refresh in Cascade's MCP panel:

```json
{
  "mcpServers": {
    "opsknight": { "serverUrl": "https://ops.your-company.com/mcp" }
  }
}
```

The file is `~/.codeium/windsurf/mcp_config.json` in Windsurf, and `~/.config/devin/mcp_config.json` (or `.devin/mcp_config.json` in a project) in Devin Desktop, which still reads the legacy Windsurf paths. `url` is accepted in place of `serverUrl`.

When the server shows **Needs authentication**, select **Authenticate**, sign in to OpsKnight and approve.

## Personal access token (alternative)

```json
{
  "mcpServers": {
    "opsknight": {
      "serverUrl": "https://ops.your-company.com/mcp",
      "headers": { "Authorization": "Bearer ${env:OPSKNIGHT_TOKEN}" }
    }
  }
}
```

`${env:NAME}` is expanded in `serverUrl`, `url` and `headers`.

## Known limits

- Cascade is limited to **100 tools** available at a time (stated on the German-language vendor page; the English pages fetched do not state it). OpsKnight lists at most 54; turn off tools of other servers if you exceed the cap.
- On Teams and Enterprise, an administrator must turn MCP on, and once any server is allowlisted every other server is blocked. Ask for a pattern that matches your OpsKnight URL (anchored, case-sensitive regular expression).
- No result-size limit is documented.

## Troubleshooting

- Press refresh in the MCP panel after editing the file.
- **Needs authentication** after a few days: the sign-in expired; select **Authenticate** again.
- An invalid allowlist regular expression is logged and blocks the server; check it with your administrator.
