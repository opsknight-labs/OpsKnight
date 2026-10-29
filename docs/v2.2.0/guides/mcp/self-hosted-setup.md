# MCP setup for any self-hosted OpsKnight

The same setup applies to Docker, Compose, Swarm, Kubernetes and virtual machines. There is no OpsKnight-hosted registration service, special test domain or separate MCP secret. Your installation publishes its own endpoint and OAuth discovery using its configured App URL.

## Administrator: configure once

1. Deploy the updated application and packaged database migrations through your normal OpsKnight upgrade process. Update every replica before enabling automatic registration.
2. Open **Settings → System** and set **App URL** to the HTTPS origin users open, such as `https://ops.your-company.com`. Use an origin without a path. Keep the existing application authentication and encryption secrets consistent across replicas and restarts.
3. Open **Settings → Integrations & ChatOps → MCP (AI Assistants)**. Enable MCP and **Allow assistants to register automatically**. Start with `incidents:read services:read schedules:read` and writes disabled.
4. Save the policy. The shared success banner confirms completion; the connection section shows whether automatic connections are configured.
5. Copy the endpoint or Claude command from that page. Each user signs in and approves their own connection; administrators do not create a separate client ID for every person.

Keep the existing scheduler/worker roles running when using a split deployment; MCP uses normal application maintenance and does not require a new queue or worker.

No MCP-specific environment variable is required. Existing optional overrides, especially `MCP_PUBLIC_ORIGIN`, must be consistent across replicas or removed to use the App URL. The settings page identifies the origin source and configuration problems.

## Users: connect and sign in

For Claude Code, copy the installation's command, for example:

```sh
claude mcp add --scope user --transport http opsknight https://ops.your-company.com/mcp
```

Start Claude Code, enter `/mcp`, select OpsKnight and authenticate. Complete native OpsKnight login, including your configured SSO when applicable, then review and approve the displayed return address and scopes. Automatically registered application names are not verified identities.

For ChatGPT, add a custom remote MCP server/plugin, paste the same endpoint, select OAuth and use automatic registration. Complete native login and consent. Do not enter the application encryption key or a user's OpsKnight password into client-ID or client-secret fields. Ordinary users do not need administrator rights to connect; tools remain constrained by their current roles, resource visibility and approved scopes.

Desktop loopback callback addresses belong to the user's computer. The assistant chooses its callback and port; do not open a callback port on the OpsKnight server or configure one shared callback for all users.

The server targets MCP revision **2026-07-28** over HTTP. Use a client that supports that revision and OAuth PKCE. Older clients using legacy initialization/session semantics are not supported. Supported client versions still require full sign-in, scoped-call, refresh and revocation verification; discovery alone is not interoperability certification.

CIMD is an optional alternative for explicitly trusted metadata hosts. Current MCP guidance prefers it, while DCR remains the general compatibility path. This server selects public `none` only when the document supports it; private-key-only clients are rejected. A published JWKS URL is never fetched or used as proof of identity in this public-client flow.

## Manage connections

Users open the same MCP settings page to search and revoke **Your grants**. Administrators can review **Clients** and **Client grants**, revoke a client and its grants, or use the confirmation-gated **Revoke all MCP connections** action. Disabling MCP provides an MCP-only shutdown.

Keep writes disabled until you need them. When enabled, assistants prepare changes for approval by another authorized human in OpsKnight; an assistant cannot approve its own changes. Revocation, current permissions and scope ceilings are rechecked during authentication and protected operations.

Rotating the active application encryption key invalidates MCP credentials. Keeping an old key only for decryption does not keep its MCP credentials valid. Users reconnect after rotation; preserve the key during ordinary restarts and image upgrades.

## Reverse proxies and private installations

Route `/mcp`, `/oauth/mcp/*`, `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/oauth/mcp` to the application. Native `/login`, `/api/auth/*` and MCP settings/consent routes must remain available too.

Preserve the public Host, including a non-default port when used. Preserve Authorization, WWW-Authenticate and MCP protocol headers. Do not cache OAuth/consent responses or rewrite their issuer/resource URLs. Support streaming POST responses without proxy buffering; the server's subscription lifetime is bounded to ten minutes. Configure normal connection and upload limits at the ingress. Trust forwarded client IPs only when your ingress removes spoofed forwarding headers.

A private installation can serve clients that can reach its network. Cloud-hosted assistants need their own supported network path to it; browser access from an administrator's laptop does not prove cloud-client reachability. Keep normal TLS verification enabled. For a private CA, configure the client's supported CA trust rather than disabling certificate checks. Managed cloud assistants may require a publicly trusted certificate.

## Check and troubleshoot

From an OpsKnight checkout or the application container:

```sh
node scripts/mcp/doctor.cjs https://ops.your-company.com/mcp
# From a checkout, the equivalent command is:
npm run mcp:doctor -- https://ops.your-company.com/mcp --json
```

The checker uses bounded, anonymous requests and follows no redirects. It checks discovery/resource binding, PKCE metadata, automatic registration and the protected endpoint's 401 challenge. It creates no credentials or settings. It cannot certify real sign-in, production load, HA or every proxy replica.

- **Registration is missing:** enable automatic registration and save; verify migrations and application rollout. Restart/reconnect a client that cached older metadata.
- **401 after connecting:** sign in again. Check revocation, account status, permission changes and encryption-key consistency across replicas.
- **403 or a wrong resource/issuer:** verify App URL and public Host preservation. Do not use an internal container hostname as the public origin.
- **503/unavailable:** check MCP enablement, configuration issues, application health and database migrations. Admission limits intentionally shed excess work.
- **Works in a browser but not ChatGPT:** verify reachability and TLS from the cloud client, not just your laptop. Check the client's protocol support and workspace policy.
- **One replica works intermittently:** verify the same application version, database, App URL/overrides and encryption key on all replicas. Repeated doctor calls do not prove every node is correct.

Before production rollout, verify actual supported-client consent, scoped reads, refresh and revocation against the intended deployment. Use the existing [local certification workflow](../../operate/mcp/certification.md) and [architecture/rollout limits](../../operate/mcp/architecture.md). Local passing tests are not universal capacity or GA certification. Before rollback to older application code, disable MCP and revoke dynamic client records while the new schema/code is still available, as described in the architecture guide.
