import type { McpServer } from '@modelcontextprotocol/server';
import { mcpOrigin } from '../auth/config';
import { MCP_APP_VIEWS, REVIEW_BASE_PLACEHOLDER } from './app-widgets';
import { clientDeclares, type McpEdgeContext } from './skills';

/** MCP Apps (SEP-1865): https://modelcontextprotocol.io/extensions/apps/overview */
export const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

function supportsApps(context: McpEdgeContext) {
  if (!clientDeclares(context, MCP_APPS_EXTENSION)) return false;
  const mimeTypes =
    // eslint-disable-next-line security/detect-object-injection -- constant extension identifier
    (context.clientExtensions?.[MCP_APPS_EXTENSION] as { mimeTypes?: unknown })?.mimeTypes;
  // A client that lists its MIME types must list ours; one that lists none is taken at its word.
  return !Array.isArray(mimeTypes) || mimeTypes.includes(MCP_APP_MIME_TYPE);
}

/**
 * For a client that declared MCP Apps on this request: serve the three `ui://` views and link
 * them from their tools' `_meta.ui.resourceUri`. Call before tools are registered. Otherwise
 * nothing changes, so tools/list is identical for every other client.
 */
export function attachMcpApps(server: McpServer, context: McpEdgeContext) {
  if (!supportsApps(context)) return;
  server.server.registerCapabilities({ extensions: { [MCP_APPS_EXTENSION]: {} } });
  const viewFor = new Map<string, string>();
  for (const view of Object.values(MCP_APP_VIEWS)) {
    for (const tool of view.tools) viewFor.set(tool, view.uri);
    server.registerResource(
      view.name,
      view.uri,
      { mimeType: MCP_APP_MIME_TYPE, description: `${view.name} (static view, no network)` },
      async () => ({
        contents: [
          {
            uri: view.uri,
            mimeType: MCP_APP_MIME_TYPE,
            // The server's own origin, escaped for a script context; never data from a result.
            text: view.html.replace(REVIEW_BASE_PLACEHOLDER, () =>
              JSON.stringify(mcpOrigin()).replace(/</g, '\\u003c')
            ),
            // No csp field: the host's default policy (no network at all) applies.
            _meta: { ui: { prefersBorder: true } },
          },
        ],
      })
    );
  }
  const registerTool = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  Object.assign(server, {
    registerTool: (
      name: string,
      config: { _meta?: Record<string, unknown> },
      ...rest: unknown[]
    ) => {
      const resourceUri = viewFor.get(name);
      return registerTool(
        name,
        resourceUri ? { ...config, _meta: { ...config._meta, ui: { resourceUri } } } : config,
        ...rest
      );
    },
  });
}
