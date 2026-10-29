# MCP setup for any self-hosted OpsKnight

The same setup applies to Docker, Compose, Swarm, Kubernetes and virtual machines. There is no OpsKnight-hosted registration service, special test domain or separate MCP secret. Your installation publishes its own endpoint and OAuth discovery using its configured App URL.

## Administrator: turn it on (about two minutes)

1. Deploy the updated application and packaged database migrations through your normal OpsKnight upgrade process. Update every replica before turning MCP on.
2. Open **Settings → System** and set **App URL** to the HTTPS origin users open, such as `https://ops.your-company.com` (an origin without a path). Keep the application authentication and encryption secrets consistent across replicas and restarts.
3. Open **Settings → Integrations & ChatOps → MCP (AI Assistants)** and click **Turn on AI assistant access**. That one click enables MCP read-only (incidents, services, on-call schedules) with automatic connections. If something blocks it, the page lists exactly what to fix first.
4. Click **Test connection** on the same page. It checks the App URL, database migrations, sign-in discovery, automatic connections and that anonymous access is refused, and tells you what to fix.
5. Share the **MCP server URL** shown on the page. Each person adds it to their assistant, signs in with their own OpsKnight account and approves once. You never create a client ID, secret or callback for anyone.

Keep the existing scheduler/worker roles running when using a split deployment; MCP uses normal application maintenance and does not require a new queue or worker. No MCP-specific environment variable is required. The optional `MCP_PUBLIC_ORIGIN` override must be identical across replicas or removed.

### Fine-tuning (optional)

Under the same page's policy form you can choose what assistants may do with scope checkboxes, how long a connection stays signed in, and (under **Advanced**) enable reviewed changes, sensitive reads, workload limits, or restrict automatically identifying assistants to specific hosts. **Automatic connections** is one switch: it covers assistants that register themselves and assistants that identify with a client metadata document, under the same scope ceiling. Leave the host list empty to allow any public HTTPS host; the server fetches such documents without redirects, only from public addresses, with a pinned DNS lookup.

## Users: connect and sign in

Copy the **MCP server URL** from the MCP page (Settings → Integrations & ChatOps → MCP (AI Assistants)). The page also shows per-assistant instructions.

- **Claude Code:** `claude mcp add --scope user --transport http opsknight https://ops.your-company.com/mcp`, then `/mcp` to sign in.
- **Claude and ChatGPT apps:** add a custom connector in the app's connectors settings, paste the URL and choose OAuth. Menu names vary by app version, and some plans require a workspace administrator to allow custom connectors.
- **Cursor:** add `{"mcpServers":{"opsknight":{"url":"https://ops.your-company.com/mcp"}}}` to `~/.cursor/mcp.json`.
- **VS Code:** `code --add-mcp '{"name":"opsknight","type":"http","url":"https://ops.your-company.com/mcp"}'`.

Your browser opens one focused OpsKnight page: sign in if needed (including your configured SSO), review the plain-language list of what the assistant can do, then click **Allow**. If the page cannot continue it says why in plain words rather than showing a raw error. Automatically registered application names are not verified identities, so only continue if you just started the connection yourself. Ordinary users do not need administrator rights; tools remain constrained by current roles, resource visibility and approved scopes. Never enter the application encryption key or a password in client-ID or client-secret fields.

Connections stay signed in while they are used. By default a connection ends after 30 days without use and after 90 days in total (administrators can shorten the idle period). Changing your password, an administrator disconnecting you, or turning automatic connections off ends it immediately. Assistants that send generic scopes such as `openid` or `offline_access`, or that omit the optional `resource` parameter, still connect and receive only what policy allows.

Desktop loopback callback addresses belong to the user's computer. The assistant chooses its callback and port; do not open a callback port on the OpsKnight server or configure one shared callback for all users.

The server targets MCP revision **2026-07-28** over HTTP. Use a client that supports that revision and OAuth PKCE. Older clients using legacy initialization/session semantics are not supported. Supported client versions still require full sign-in, scoped-call, refresh and revocation verification against your deployment; discovery alone is not interoperability certification. A client that only supports private-key (`private_key_jwt`) authentication is rejected, and a published JWKS URL is never fetched or used as proof of identity.

## Manage connections

Users open the same MCP page to review and disconnect **Your grants**, each showing the assistant, when it was last used and when it will sign out. Administrators see **Clients** and **Client grants** with people's names and emails, can disconnect a client and its grants (and allow it again later; users then sign in again), or use the confirmation-gated **Revoke all MCP connections** action. Changes are recorded in the general Audit log page. Turning off **Enable MCP** is an MCP-only shutdown.

Keep writes disabled until you need them. When enabled, assistants prepare changes for approval by another authorized human in OpsKnight; an assistant cannot approve its own changes. Revocation, current permissions and scope ceilings are rechecked during authentication and protected operations.

Rotating the active application encryption key invalidates MCP credentials. Keeping an old key only for decryption does not keep its MCP credentials valid. Users reconnect after rotation; preserve the key during ordinary restarts and image upgrades.

## Reverse proxies and private installations

Route `/mcp`, `/oauth/mcp/*`, `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/oauth/mcp` to the application. Native `/login`, `/api/auth/*` and MCP settings/consent routes must remain available too.

Preserve the public Host, including a non-default port when used. Preserve Authorization, WWW-Authenticate and MCP protocol headers. Do not cache OAuth/consent responses or rewrite their issuer/resource URLs. Support streaming POST responses without proxy buffering; the server's subscription lifetime is bounded to ten minutes. Configure normal connection and upload limits at the ingress. Trust forwarded client IPs only when your ingress removes spoofed forwarding headers.

A private installation can serve clients that can reach its network. Cloud-hosted assistants need their own supported network path to it; browser access from an administrator's laptop does not prove cloud-client reachability. Keep normal TLS verification enabled. For a private CA, configure the client's supported CA trust rather than disabling certificate checks. Managed cloud assistants may require a publicly trusted certificate.

## Check and troubleshoot

The **Test connection** button on the MCP page runs these checks from the server. To test from outside (for example a laptop on the public internet), run from an OpsKnight checkout or the application container:

```sh
node scripts/mcp/doctor.cjs https://ops.your-company.com/mcp
# From a checkout, the equivalent command is:
npm run mcp:doctor -- https://ops.your-company.com/mcp --json
```

The checker uses bounded, anonymous requests and follows no redirects. It checks discovery/resource binding, PKCE metadata, automatic registration and the protected endpoint's 401 challenge. It creates no credentials or settings. It cannot certify real sign-in, production load, HA or every proxy replica.

- **Registration is missing:** turn on **Automatic connections** and save; verify migrations and application rollout. Restart/reconnect a client that cached older metadata.
- **401 after connecting:** sign in again. Check revocation, account status, permission changes and encryption-key consistency across replicas.
- **403 or a wrong resource/issuer:** verify App URL and public Host preservation. Do not use an internal container hostname as the public origin.
- **503/unavailable:** check MCP enablement, configuration issues, application health and database migrations. Admission limits intentionally shed excess work.
- **Works in a browser but not ChatGPT:** verify reachability and TLS from the cloud client, not just your laptop. Check the client's protocol support and workspace policy.
- **One replica works intermittently:** verify the same application version, database, App URL/overrides and encryption key on all replicas. Repeated doctor calls do not prove every node is correct.

Before production rollout, verify actual supported-client consent, scoped reads, refresh and revocation against the intended deployment. Use the existing [local certification workflow](../../operate/mcp/certification.md) and [architecture/rollout limits](../../operate/mcp/architecture.md). Local passing tests are not universal capacity or GA certification. Before rollback to older application code, disable MCP and revoke dynamic client records while the new schema/code is still available, as described in the architecture guide.
