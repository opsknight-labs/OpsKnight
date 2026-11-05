/**
 * Where the MCP documentation lives. The v2.2.0 docs tree is not on the docs site until that
 * release is published, so links point at the files in the public repository. Switch this base to
 * https://opsknight.com/docs/v2.2.0 once the release docs are published.
 */
const BASE = 'https://github.com/opsknight-labs/opsknight/blob/main/docs/v2.2.0';

/** Repository path (relative to the root) for each link; a test checks every file exists. */
export const MCP_DOCS_PATHS = {
  guide: 'docs/v2.2.0/guides/mcp/self-hosted-setup.md',
  troubleshooting: 'docs/v2.2.0/guides/mcp/troubleshooting.md',
  permissions: 'docs/v2.2.0/reference/mcp/permissions.md',
} as const;

export const MCP_DOCS_LINKS = {
  guide: `${BASE}/guides/mcp/self-hosted-setup.md`,
  troubleshooting: `${BASE}/guides/mcp/troubleshooting.md`,
  permissions: `${BASE}/reference/mcp/permissions.md`,
} as const satisfies Record<keyof typeof MCP_DOCS_PATHS, string>;
