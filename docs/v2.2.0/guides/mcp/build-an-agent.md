---
title: Build an agent
order: 4
description: Connect your own code to an OpsKnight MCP server with the MCP SDK, page through results, retry safely and drive the approval loop.
type: developer
product_area: mcp
audience: [developer]
verification:
  level: source
  verified_at: 2026-11-05
  evidence:
    - src/app/mcp/route.ts
    - src/lib/mcp/protocol/server.ts
    - src/lib/mcp/approvals/operation.ts
    - src/lib/mcp/approvals/runbook.ts
    - tests/helpers/mcp-sdk-handshake.ts
    - tests/integration/mcp-sdk-clients.test.ts
---

# Build an agent

This page is for people writing their own agent or integration against an OpsKnight server. To work on OpsKnight itself, see [Contributing to MCP](../../operate/mcp/contributing.md).

Only Claude Code has a recorded live run (see [client compatibility](self-hosted-setup.md#client-compatibility)). The TypeScript connection below is the same client the certification tests use (`tests/helpers/mcp-sdk-handshake.ts`); the other snippets are illustrative and should be run against a local instance first.

## Before you start

- An administrator must turn MCP on and turn on **Automatic connections** (Access policy), so your agent can register itself or identify itself with a client metadata document. Alternatively an administrator registers your client by hand on the Assistants tab.
- Every person signs in as themselves. The agent acts with that person's current permissions, within the scopes they approved.
- Never paste tokens into tool arguments or prompts.

## Connect (TypeScript)

The server speaks Streamable HTTP at `<App URL>/mcp`. With `@modelcontextprotocol/sdk` 1.32.2:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(new URL('https://ops.your-company.com/mcp'), {
  // Implements OAuthClientProvider: the SDK discovers the authorization server from
  // /.well-known/oauth-protected-resource/mcp, registers (or uses your client metadata
  // document URL as client_id), runs PKCE S256 with resource=<App URL>/mcp and a loopback
  // redirect such as http://127.0.0.1:<any port>/callback, and refreshes tokens.
  authProvider: myOAuthProvider,
});
const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);
const me = await client.callTool({ name: 'whoami', arguments: {} });
```

The SDK offers revision 2025-11-25; the server also serves 2025-06-18 and its native 2026-07-28. 2025 revisions are served statelessly: no session id, and a GET for a standalone stream returns 405, which the SDK handles.

## Connect (Python)

With the `mcp` package's Streamable HTTP client and an OAuth provider:

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client("https://ops.your-company.com/mcp", auth=oauth) as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        me = await session.call_tool("whoami", {})
```

## Read and page

Call `whoami` first: it returns your user id (use `assigneeId: "me"` in incident lists instead of resolving it yourself), role, teams, effective scopes and the enabled tools. Then use a named tool, or `search_capabilities`, `describe_operation` and `read_operation` for anything else:

```ts
let cursor: string | undefined;
do {
  const page = await client.callTool({
    name: 'incident_search',
    arguments: { query: { limit: 50, assigneeId: 'me', ...(cursor ? { cursor } : {}) } },
  });
  const data = (page.structuredContent as { data: { pagination?: { nextCursor?: string } } }).data;
  cursor = data.pagination?.nextCursor;
} while (cursor);
```

`query.limit` is 1 to 50 (default 25). `execute_plan` runs up to eight reads as one request.

## Change something safely

Routine changes (when an administrator allows changes) take a stable `idempotencyKey`. If a response is lost, retry with identical input and the same key; OpsKnight applies the change once:

```ts
const args = { path: { id: incidentId }, idempotencyKey: `ack-${incidentId}` };
await client.callTool({ name: 'incident_acknowledge', arguments: args }); // safe to repeat
```

## The approval loop

Configuration changes never run directly:

1. `operation_prepare` with `operationId`, `args` (as `describe_operation` describes them; revision-bound operations need `ifMatch`) and an `idempotencyKey` of 16 to 128 letters, digits, `-` or `_`. It returns an `approvalId`, `reviewUrl` and `expiresAt`.
2. Show `reviewUrl` to a person. They approve or reject it in OpsKnight; the agent can never approve.
3. Poll `operation_get_approval`. While `PENDING` it returns `pollAfterSeconds`; back off from that, cap the interval, and stop at `expiresAt` (the review window, 240 minutes by default).
4. When `APPROVED`, call `operation_commit_approved` with the `approvalId` before `commitDeadline` (30 minutes after approval by default). Retry the same `approvalId` after a failed or lost response; a committed change is never repeated.
5. `REJECTED` carries the reviewer's reason, labelled untrusted. `EXPIRED` means prepare again with a new `idempotencyKey`.

Runbooks use the same shape: `runbook_prepare_execution`, `runbook_get_approval`, `runbook_execute_approved`.

## Errors

| Signal                                     | What to do                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `retryable: true` with `retryAfterSeconds` | Wait that long, then retry the same call.                                   |
| `MCP_SCOPE_NOT_GRANTED`                    | The connection lacks the scope: ask the person to reconnect and approve it. |
| `MCP_OPERATION_FORBIDDEN`                  | The person's role cannot do this. Do not retry.                             |
| HTTP 401                                   | Refresh the token; if refresh fails, sign in again.                         |
| HTTP 429 or 503                            | Back off for the `Retry-After` interval.                                    |

Every code, with its fix, is in [troubleshooting](troubleshooting.md). Each tool result carries a `requestId` that matches the server's `X-Request-Id` and log lines.
