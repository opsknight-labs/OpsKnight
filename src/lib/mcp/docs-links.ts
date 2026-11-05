/**
 * Where the MCP documentation lives. Every link is derived from MCP_DOCS_PATHS, the single source
 * of truth. The v2.2.0 docs tree is not on the docs site until that release is published, so links
 * point at the files in the public repository. Publishing the site is one switch below and can only
 * produce slug-shaped URLs (no `.md` suffix). Do not link a release tag: older tags have no
 * docs/v2.2.0 tree.
 */
export const MCP_DOCS_SITE = 'https://opsknight.com/docs';
export const MCP_DOCS_REPOSITORY = 'https://github.com/opsknight-labs/OpsKnight/blob/main';
const SITE_PUBLISHED = false;

/** Repository path (relative to the root) for each link; a test checks every file exists. */
export const MCP_DOCS_PATHS = {
  guide: 'docs/v2.2.0/guides/mcp/self-hosted-setup.md',
  troubleshooting: 'docs/v2.2.0/guides/mcp/troubleshooting.md',
  permissions: 'docs/v2.2.0/reference/mcp/permissions.md',
} as const;

export function mcpDocsHref(path: string, published = SITE_PUBLISHED) {
  return published
    ? `${MCP_DOCS_SITE}/${path.replace(/^docs\//, '').replace(/\.md$/, '/')}`
    : `${MCP_DOCS_REPOSITORY}/${path}`;
}

export const MCP_DOCS_LINKS = {
  guide: mcpDocsHref(MCP_DOCS_PATHS.guide),
  troubleshooting: mcpDocsHref(MCP_DOCS_PATHS.troubleshooting),
  permissions: mcpDocsHref(MCP_DOCS_PATHS.permissions),
} as const satisfies Record<keyof typeof MCP_DOCS_PATHS, string>;

/** A deep link to one code's row on the generated troubleshooting page. */
export function mcpTroubleshootingLink(code: string) {
  return `${MCP_DOCS_LINKS.troubleshooting}#${encodeURIComponent(code)}`;
}
