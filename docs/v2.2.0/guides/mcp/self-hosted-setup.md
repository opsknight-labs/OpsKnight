---
title: MCP setup for any self-hosted OpsKnight
order: 1
description: Turn on AI assistant access, connect assistants, manage connections and review the changes assistants propose.
type: how-to
product_area: mcp
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-11-05
  evidence:
    - src/app/(app)/settings/integrations/mcp/page.tsx
    - src/app/(app)/settings/integrations/mcp/actions.ts
    - src/lib/mcp/auth/effective-access.ts
    - src/lib/mcp/approvals/operation.ts
    - src/lib/runbooks/preview-review.ts
    - src/lib/mcp/approvals/notify.ts
    - src/components/settings/mcp/setup-commands.ts
    - src/lib/mcp/auth/device-flow.ts
    - src/app/oauth/mcp/device_authorization/route.ts
    - tests/integration/mcp-device-flow.test.ts
    - docs/v2.2.0/operate/mcp/certification.md
    - tests/mcp/docs-reference.test.ts
---

# MCP setup for any self-hosted OpsKnight

The same setup applies to Docker, Compose, Swarm, Kubernetes and virtual machines. There is no OpsKnight-hosted registration service, special test domain or separate MCP secret. Your installation publishes its own endpoint and OAuth discovery from its configured App URL.

Everything below lives on one page: **Settings → Integrations & ChatOps → MCP (AI Assistants)**. Its tabs are **Overview**, **Connect**, **Connections** (people other than administrators see **Your connections**), **Assistants**, **Approvals** (runbook approvers who are not administrators see **Runbook approvals**), **Access policy** and **Exposed capabilities**. Assistants, Access policy and Exposed capabilities are for administrators only.

## Administrator: turn it on (about two minutes)

1. Deploy the application and its packaged database migrations through your normal upgrade process. Update every replica before turning MCP on.
2. Open **Settings → System** and set **App URL** to the HTTPS origin users open, such as `https://ops.your-company.com` (an origin without a path). Keep the authentication and encryption secrets the same across replicas and restarts.
3. On the **Overview** tab click **Turn on AI assistant access**. On first use this applies read-only defaults (`incidents:read`, `services:read`, `schedules:read`) with **Automatic connections** on. If something blocks it, the page lists what to fix first.
4. Click **Test connection** on the same tab. It checks the App URL, migrations, sign-in discovery, automatic connections and that anonymous access is refused.
5. Share the **MCP server URL** from the **Connect** tab. Each person adds it to their assistant, signs in with their own OpsKnight account and approves once. You never create a client ID, secret or callback for anyone.

Keep the existing scheduler and worker roles running in a split deployment; MCP needs no new queue or worker and no MCP-specific environment variable. The optional `MCP_PUBLIC_ORIGIN` override must be identical across replicas, or removed.

### Turning it off and back on

Unchecking **Enable MCP** on the **Access policy** tab is an immediate, MCP-only shutdown: every assistant request is refused and the rest of OpsKnight is unaffected. It does **not** revoke connections. When MCP is turned back on, existing connections resume.

While MCP is off the Overview button reads **Turn AI assistant access back on**. It restores your previous policy unchanged: the permission ceiling, Automatic connections, reviewed actions, sensitive reads, trusted hosts and workload limits. The card lists what will come back. For a clean restart, use **Revoke all active connections** (below) before turning MCP back on, and review **Access policy** first.

## Access policy

The **Access policy** tab holds:

- **Assistant access**: **Enable MCP** and **Automatic connections**.
- **What assistants may do**: the permission ceiling. People can approve less on the consent page, and their own OpsKnight permissions always apply on top.
- **Reviewed actions**: changes, the review window and commit window, and sensitive configuration reads.
- **Sign-in sessions**: how long an unused connection stays signed in (1 to 90 days, default 30).
- **View-only connections**: **Require view-only connections** caps every connection, OAuth and personal, to view permissions until it is turned off.
- **Personal access tokens**: off by default. When on, people can create a token for agents without a browser, up to the longest allowed expiry (default 30, at most 90 days) and with only the listed permissions (default: view incidents, services and schedules). Tokens never carry `runbooks:execute`, and changes they prepare always need a second person. Turning this off revokes every token. See [API-hosted and headless agents](api-agents.md).
- **Device sign-in**: off by default. Lets command-line tools, SSH sessions and headless servers sign in with a short code entered in any browser (OAuth 2.0 device authorization grant, RFC 8628). Turning it on needs a recent sign-in. See [Sign in from a CLI or server (device code)](#sign-in-from-a-cli-or-server-device-code).
- **Advanced**: **Trusted assistant hosts**, **Browser clients** (allowed browser origins and in-place permission step-up) and **Workload limits**.

**Automatic connections** is one switch for both ways an assistant can identify itself: assistants that register themselves (dynamic client registration, DCR) and assistants that publish a client metadata document (CIMD). Both use the same ceiling. The trusted-hosts list is optional: leave it empty to allow any public HTTPS metadata host, or list hosts to allow only those (other metadata-document assistants are then refused). Documents are fetched without redirects, only from public addresses, with a pinned DNS lookup.

If two administrators edit the policy at once, the second save is refused with a notice and a **Reload policy** button, so nobody overwrites a change they never saw.

See the [permissions reference](../../reference/mcp/permissions.md) for what each permission unlocks and which roles can use it.

## Users: connect and sign in

Copy the **MCP server URL** from the **Connect** tab; it also shows step-by-step instructions per assistant.

- **Claude Code:** run `claude mcp add --scope user --transport http opsknight 'https://ops.your-company.com/mcp'`, then `/mcp` to sign in.
- **Claude apps:** in **Settings → Connectors** choose **Add custom connector**, paste the URL and connect. Menu names vary by version, and Team and Enterprise plans need an owner to allow custom connectors.
- **ChatGPT:** open ChatGPT Plugins (`chatgpt.com/plugins`), select **+**, then **Add custom MCP server** and name it OpsKnight. Under Connection paste the URL for a public server, or choose **Tunnel** for a private installation (see [OpenAI Secure MCP Tunnel](#private-installation-openai-secure-mcp-tunnel)). Choose OAuth; ChatGPT registers itself. Accept the warning, select **Create** as a plugin, then sign in to OpsKnight and approve. Developer mode or a workspace administrator's permission may be required, and some plans allow only read and fetch tools. OpenAI's [custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) has the current menus.
- **ChatGPT company knowledge and deep research:** these call only a `search` and a `fetch` tool. OpsKnight serves both (on by default): they find and read the incidents, postmortems, runbooks and services the person can see, with a link back to OpsKnight for each answer. An administrator can turn them off under exposed capabilities.
- **Cursor:** use **Add to Cursor** on the Connect tab, or add the `opsknight` entry under `mcpServers` in `~/.cursor/mcp.json`, merging it into the file if it already exists so your other servers are kept.
- **VS Code:** use **Add to VS Code**, or on macOS and Linux run `code --add-mcp '{"name":"opsknight","type":"http","url":"https://ops.your-company.com/mcp"}'`. On Windows use the link or **MCP: Add Server** in the Command Palette.
- **Codex CLI:** run `codex mcp add opsknight --url 'https://ops.your-company.com/mcp'`, then `codex mcp login opsknight`.
- **Gemini CLI:** run `gemini mcp add --transport http opsknight 'https://ops.your-company.com/mcp'` (or set `httpUrl`, not `url`, under `mcpServers.opsknight` in `~/.gemini/settings.json`; `url` selects the older SSE transport), then `/mcp auth opsknight` inside Gemini CLI.
- **Windsurf:** add `{"mcpServers":{"opsknight":{"serverUrl":"https://ops.your-company.com/mcp"}}}` to `~/.codeium/windsurf/mcp_config.json` and sign in when prompted.
- **Hosts that only run local (stdio) servers:** a third-party bridge such as `npx -y mcp-remote 'https://ops.your-company.com/mcp'` can relay to OpsKnight. It is not part of OpsKnight, and it stores tokens on disk in `~/.mcp-auth`.

After approving, select **Check connection** on the Connect tab: it shows the connection you just made, or what to do next.

### What you see when you approve

Your browser opens one OpsKnight page. Sign in if needed (including your SSO), then review what the assistant may do:

- The page says where it returns to ("Returns to _host_") and how the assistant is identified: "Identified by _host_" for a metadata-document assistant, "Name not verified" for one that registered itself, or "Registered by an administrator". Only continue if you just started the connection yourself. A self-registered assistant that returns to a web address that is not on your computer shows a warning.
- Permissions are checkboxes grouped by area. View permissions are pre-selected. Change permissions are pre-selected only when the assistant asked for them by name, or when the connection you are replacing had them.
- You can untick anything; **Allow** needs at least one permission.
- **View only** (off by default) leaves every change permission out of the connection, whatever is ticked.
- Permissions your role can never use are hidden and noted on the page. `admin:manage` is never offered.
- When changes are turned off, a banner says so and change permissions show **Changes off**.
- The page expires after five minutes.

What the assistant can then do is your selection, capped by the administrator ceiling as it is now and by your current role and teams. Connecting the same assistant again starts with your earlier permissions selected and cleans up any earlier sign-in that was never completed; a connection already in use, such as the same assistant on another device, stays signed in. Never enter the encryption key or a password in client-ID or client-secret fields.

### How long a connection lasts

Connections stay signed in while they are used. A connection ends after the idle period without use (default 30 days) and always after 90 days in total.

Changes to your role or teams do **not** sign you out: what the assistant can do narrows or widens on the next request. These security events end the connection immediately, and you reconnect from your assistant (`MCP_ACCESS_CHANGED`):

- your password is changed or reset, or your email is changed by an administrator or SCIM;
- you are demoted from Administrator;
- your account is deactivated (reactivating it does not bring old connections back);
- you sign out everywhere, or an administrator revokes your sessions.

An administrator revoking your connection or its assistant, or policy no longer trusting the assistant (Automatic connections off, or its host removed from the trusted list), also stops it. Assistants that send generic scopes such as `openid` or `offline_access`, or omit the optional `resource` or `state` parameters, still connect and receive only what policy allows.

Desktop loopback callback addresses belong to the user's computer. The assistant chooses its callback and port; do not open a callback port on the OpsKnight server.

Callback addresses must be HTTPS, http on a loopback host (any port), or a native app's own scheme (RFC 8252): a reverse-DNS scheme such as `com.example.app:/callback`, or one of `cursor`, `vscode`, `vscode-insiders` and `windsurf`. App-scheme and HTTPS callbacks match exactly. For a manually registered Cursor client, the IDE uses `cursor://anysphere.cursor-mcp/oauth/callback`, the CLI `http://localhost:8787/callback` and Cloud Agents `https://www.cursor.com/agents/mcp/oauth/callback`. Assistants may send registration metadata this server does not use (for example OIDC logout addresses); it is ignored and never stored. Client secrets and key material are refused.

### Sign in from a CLI or server (device code)

Use this when the tool runs where no browser can open: over SSH, in a container, on a headless server. The tool shows a code; you approve it in a browser on any other device.

An administrator first turns on **Device sign-in** under **Access policy**. Only assistants registered for it can use it:

- an assistant that registers itself (Automatic connections) and lists `urn:ietf:params:oauth:grant-type:device_code` in its `grant_types`. A device-only client may leave out `redirect_uris`;
- an assistant an administrator registers on the **Assistants** tab with **Allow device sign-in with a code** ticked.

Assistants identified by a client metadata document cannot use device sign-in: OpsKnight never fetches a URL on behalf of an anonymous device request.

Then:

1. The tool calls `POST <App URL>/oauth/mcp/device_authorization` and shows you a code such as `BCDF-GHJK` and the address `<App URL>/oauth/mcp/device` (or a link with the code filled in).
2. Open that address in any browser and sign in. Type the code (case and the dash do not matter), or check that the filled-in code matches the one on your device, and choose **Continue**. The page never continues by itself.
3. You see the same permissions page as a browser sign-in, with a warning: **Only continue if you started this sign-in yourself on a device you control.** Someone who sends you a code or a link is trying to get access as you; choose **Cancel**.
4. Approve. The tool finishes signing in on its next poll, within a few seconds.

Codes last ten minutes and work once. The connection is the same as any other: same permissions (your choice, within the ceiling and your role), same five-minute access tokens with refresh, same session lifetime, and it is listed and revoked under **Connections**. After five wrong codes, code entry pauses for 15 minutes for you and for your network address.

## Manage connections

- **Your connections** (everyone): each assistant you connected and each personal access token you created, with an **OAuth** or **Personal token** badge, its usable permissions, when it last made a call and with which tool, when it expires, and **Revoke**. When the policy allows personal tokens, **Personal access tokens** here creates one: it needs a recent sign-in and is shown once.
- **Connections** (administrators): every person's connections, filterable by status and assistant. The **Scopes** column shows "N of M usable": scopes no longer allowed are struck through. The **Status** column says **Blocked by policy** (MCP is off or policy no longer trusts the assistant) or **No longer allowed** (revoked assistant, inactive person, security event), with the reason on hover.
- **Revoke all active connections**, under **Credential security** on the Connections tab, revokes every connection, personal tokens included, regardless of the current filter. The dialog shows how many will be revoked and needs a ticked confirmation.
- **Assistants** (administrators): every registered assistant with its type, effective scope ceiling, connections and last call. Revoking an assistant revokes all its connections; **Restore** allows it again, and people then sign in again.

Every change is recorded in the general Audit log.

## Exposed capabilities

The **Exposed capabilities** tab is a hard deny-list across all roles and consents. Turn off individual tools, catalog operations or whole domains (a disabled domain also covers operations added to it later).

- It applies on the next request; nobody needs to reconnect.
- Disabled tools disappear from `tools/list`, `search_capabilities` and `describe_operation`, and any attempt to call them returns `MCP_CAPABILITY_DISABLED`, which is not retryable.
- Turning everything off asks for confirmation. Concurrent edits are detected and refused. Each save is audited with what was added and removed.

## Reviewed changes

Changes are off by default. Turn them on with **Allow reviewed routine mutations and approved runbook executions** under **Access policy → Reviewed actions**. Then:

- **Routine incident changes** (acknowledge, assign, add a note, resolve, create, tags and watchers) run directly, each with an `idempotencyKey`, within the person's own permissions.
- **Configuration changes** go through `operation_prepare` and are approved by an **administrator** who holds every permission the change needs.
- **Runbook runs** go through `runbook_prepare_execution` and are approved by **anyone with runbook approve permission** (Responders and Administrators by default) who can also read runbooks and see the target incident or service.

Normally a second person with approval rights reviews the exact, frozen request on the review page. An administrator may approve their own request only after ticking an explicit confirmation; the decision is recorded as self-approved in the approval history and the audit entry. Anyone else needs a second person. The assistant can never approve: no MCP, REST or tool path approves.

**Who is told.** Reviewers get an in-app notification (the bell) when a request is prepared, linking to the review page: administrators for configuration changes; runbook approvers for runbook runs (for runbooks that target an incident or service, only approvers who can see every incident or service). At most 50 people are notified; the requester is never notified of their own request. The requester gets an in-app notification when someone else decides. There is no email. Reviewers can also watch the **Approvals** tab, and the assistant is told to share the `reviewUrl`.

**Timing.** A request waits for review for **Time to review** (default 240 minutes, 15 to 1440). Approval opens a fresh **Time to apply after approval** window (default 30 minutes), never later than 24 hours after the request, so an approval near the end of the review window can still be applied. A request not decided or not applied in time expires (`MCP_APPROVAL_EXPIRED`); the assistant prepares it again with a new `idempotencyKey`.

**Deciding.** The review page shows who requested it, through which assistant and when, the catalog summary, the frozen request, and the target. Reject takes an optional reason (up to 500 characters) that the assistant can read through `operation_get_approval` or `runbook_get_approval`; it is labelled as untrusted text. Approving a destructive change needs a sign-in within the last two hours; otherwise the page offers **Confirm it's you**. The requester sees a read-only status view of their own request.

Approvals and rejections are audited. See the [catalog](../../reference/mcp/catalog.md) for the full prepare, review, poll and commit flow.

## Client compatibility

The server serves MCP revision **2026-07-28** natively and also accepts clients on revisions **2025-06-18** and **2025-11-25** (stateless; no sessions), and **2025-03-26** on a best-effort basis (tool results as text only). Clients that only speak the 2024-11-05 HTTP+SSE transport are not supported: `GET /mcp` returns 405. Tasks and resource subscriptions need 2026-07-28. All clients need OAuth with PKCE (S256).

| Client                        | Status                              | Notes                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                   | Tested (v2.1.2, 2026-11-03)         | Registration, consent, tools, scoped reads, role changes and deactivation checked against a live deployment ([checkpoint](../../operate/mcp/certification.md#live-client-checkpoint)). Refresh and grant revocation for this release are not yet recorded. |
| Claude (web and desktop apps) | Expected (2025 revisions supported) | Team and Enterprise plans need an owner to allow custom connectors. Cloud-hosted: your server must be reachable from the internet with a publicly trusted certificate.                                                                                     |
| ChatGPT                       | Expected (2025 revisions supported) | Needs a publicly reachable host with a trusted certificate, or OpenAI Secure MCP Tunnel for a private install. Identifies itself with a metadata document or registers itself.                                                                             |
| Cursor                        | Expected (2025 revisions supported) | Use **Add to Cursor** or merge the entry into `~/.cursor/mcp.json`.                                                                                                                                                                                        |
| VS Code                       | Expected (2025 revisions supported) | Use **Add to VS Code**, `code --add-mcp`, or **MCP: Add Server**.                                                                                                                                                                                          |
| Codex CLI                     | Expected (not verified)             | `codex mcp add opsknight --url <url>`, then `codex mcp login opsknight`.                                                                                                                                                                                   |
| Gemini CLI                    | Expected (not verified)             | `gemini mcp add --transport http opsknight <url>` (or `httpUrl` in `~/.gemini/settings.json`), then `/mcp auth opsknight`.                                                                                                                                 |
| Windsurf                      | Expected (not verified)             | `serverUrl` in `~/.codeium/windsurf/mcp_config.json`.                                                                                                                                                                                                      |
| API-hosted agents             | Not verified                        | Anthropic and OpenAI API agents, CI and workflow tools: an OAuth refresh loop or a personal access token. See [API-hosted and headless agents](api-agents.md).                                                                                             |

"Expected" means the client's protocol revision and OAuth flow are supported, but it has not been verified end to end. "Tested" names the version and date of a recorded live run; "Verified" is used only when a [live client checkpoint](../../operate/mcp/certification.md#live-client-checkpoint) for that version records every check (registration, consent, tools, a scoped read, refresh, a role change and revocation) against a named commit. Verify sign-in, scoped calls, refresh and revocation against your own deployment before relying on it. A client that supports only private-key (`private_key_jwt`) authentication is refused, and a published JWKS URL is never fetched.

## Reverse proxies and private installations

Route `/mcp`, `/oauth/mcp/*`, `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/oauth/mcp` to the application. Native `/login`, `/api/auth/*` and the MCP settings, consent and review pages must stay available too.

Preserve the public Host, including a non-default port. Preserve Authorization, WWW-Authenticate and MCP protocol headers. Do not cache OAuth or consent responses or rewrite their issuer or resource URLs. Support streaming POST responses without proxy buffering; subscription streams last at most ten minutes. Trust forwarded client IPs only when your ingress removes spoofed forwarding headers.

A private installation serves clients that can reach its network. Cloud-hosted assistants need their own network path to it; browser access from your laptop does not prove that. Keep TLS verification on; for a private CA configure the client's CA trust instead of disabling checks.

Rotating the active application encryption key invalidates MCP credentials; users reconnect. Keep the key across ordinary restarts and upgrades.

### Private installation: OpenAI Secure MCP Tunnel

ChatGPT normally reaches your server over the internet. For a private installation, OpenAI's Secure MCP Tunnel carries ChatGPT's MCP requests through an outbound connection from inside your network:

- Run OpenAI's `tunnel-client` on a host inside the network that has outbound HTTPS to `api.openai.com:443`.
- Set its MCP server URL to the exact App URL plus `/mcp` (the public hostname, resolvable internally, with a trusted or configured-CA certificate). Never an internal IP or service name: OpsKnight rejects any other Host with `MCP_INVALID_HOST`.
- The authorization server is not tunnelled. Each user's browser must reach `/oauth/mcp/authorize` and the consent page, and the tunnel-client host must reach the OpsKnight OAuth endpoints. OpsKnight must also be able to fetch ChatGPT's client metadata document over outbound HTTPS; otherwise ChatGPT registers itself instead.
- Prerequisites: OpenAI Platform tunnel permissions (Read and Manage to create a tunnel, Read and Use to run one) and the tunnel linked to your ChatGPT workspace. Tunnels are not usable for publicly distributed plugins. OpenAI documents limits of 10 MiB and 120 seconds per request and 600 requests a minute per tunnel.
- The same tunnel works for Codex and the Responses API.

Follow OpenAI's Secure MCP Tunnel documentation, linked from its [custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server), for the current `tunnel-client` commands; they change between versions.

## Check and troubleshoot

**Test connection** on the Overview tab runs the checks from the server. To check from outside, for example from a laptop on the public internet, download the doctor published with your release (Node.js 20; replace `2.2.0` with your version) and run it. No checkout is needed:

```sh
curl -fsSLo opsknight-mcp-doctor.cjs https://raw.githubusercontent.com/opsknight-labs/OpsKnight/v2.2.0/scripts/mcp/doctor.cjs && node opsknight-mcp-doctor.cjs 'https://ops.your-company.com/mcp'
```

The doctor is not served by OpsKnight itself: a misrouted or unhealthy instance is exactly what it diagnoses. From an OpsKnight source checkout:

```sh
node scripts/mcp/doctor.cjs 'https://ops.your-company.com/mcp'
```

or inside the application container on the server (this does not test reachability from outside):

```sh
docker exec <opsknight-container> node scripts/mcp/doctor.cjs 'https://ops.your-company.com/mcp'
```

On Kubernetes:

```sh
kubectl exec deploy/<opsknight> -- node scripts/mcp/doctor.cjs 'https://ops.your-company.com/mcp'
```

The doctor makes bounded, anonymous requests and follows no redirects. It checks discovery and resource binding, PKCE metadata, automatic registration and the protected endpoint's 401 challenge, and explains a 503 (MCP turned off, busy, or unavailable). It creates no credentials or settings and cannot certify real sign-in, load or every replica.

Every error code and server log event is listed with its fix in [MCP troubleshooting](troubleshooting.md). Before production rollout use the [local certification workflow](../../operate/mcp/certification.md) and read the [architecture and rollout limits](../../operate/mcp/architecture.md).
