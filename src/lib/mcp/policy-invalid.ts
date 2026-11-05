/**
 * Policy values the MCP settings save refuses. The server action returns them as a typed result
 * (a thrown error's message does not reach the browser in production) and the settings form shows
 * what to change next to the Save button.
 */
export const MCP_POLICY_INVALID_MESSAGES = new Map([
  [
    'MCP_DCR_REQUIRES_SCOPES',
    'Automatic connections need at least one permission. Choose what assistants may do, then save.',
  ],
  [
    'MCP_INVALID_SCOPE',
    'One of the selected permissions is not supported. Reload the page and try again.',
  ],
  [
    'MCP_INVALID_CIMD_HOST',
    'Each trusted assistant host must be a host name such as claude.ai, without a path or port.',
  ],
  [
    'MCP_INVALID_BROWSER_ORIGIN',
    'Browser origins must be exact origins such as https://app.example.com (at most 10; plain http only for localhost).',
  ],
  [
    'MCP_CONFIGURATION_INVALID',
    'MCP cannot be turned on until the setup check passes. Fix the items listed on the Overview tab, then save.',
  ],
  [
    'MCP_FORCE_DISABLED',
    'MCP is switched off by the MCP_FORCE_DISABLED environment setting on the server, so it cannot be turned on here.',
  ],
] as const);

export type McpPolicyInvalidCode =
  typeof MCP_POLICY_INVALID_MESSAGES extends Map<infer K, unknown> ? K : never;

export const isMcpPolicyInvalidCode = (code: string): code is McpPolicyInvalidCode =>
  MCP_POLICY_INVALID_MESSAGES.has(code as McpPolicyInvalidCode);
