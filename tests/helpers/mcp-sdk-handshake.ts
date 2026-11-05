import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type LegacyRevision = '2025-06-18' | '2025-11-25';
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * CERT-02: the published 1.x SDK client, the one most assistants embed today, connecting the way
 * they do. The SDK always offers its latest revision (2025-11-25); an older client is emulated by
 * offering `revision` in initialize instead, exactly what such a client sends on the wire.
 */
export async function sdkHandshake(options: {
  url: string;
  bearer: string;
  revision: LegacyRevision;
  fetch?: Fetch;
}) {
  const send: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const headersSeen: Headers[] = [];
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: { headers: { authorization: `Bearer ${options.bearer}` } },
    fetch: async (input, init) => {
      let body = init?.body;
      if (typeof body === 'string') {
        const message = JSON.parse(body) as { method?: string; params?: Record<string, unknown> };
        if (message.method === 'initialize')
          body = JSON.stringify({
            ...message,
            params: { ...message.params, protocolVersion: options.revision },
          });
      }
      if (init?.headers) headersSeen.push(new Headers(init.headers));
      return send(input, { ...init, body });
    },
  });
  const client = new Client({ name: 'opsknight-sdk-certification', version: '1.0.0' });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const whoami = await client.callTool({ name: 'whoami', arguments: {} });
    return {
      negotiated: transport.protocolVersion,
      serverInfo: client.getServerVersion(),
      toolNames: tools.tools.map(tool => tool.name),
      whoami: whoami as { structuredContent?: Record<string, unknown>; isError?: boolean },
      // The client never invents a session id; the route rejects one it did not issue.
      sentSessionId: headersSeen.some(headers => headers.has('mcp-session-id')),
    };
  } finally {
    await client.close();
  }
}
