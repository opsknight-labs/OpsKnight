import type { McpServer } from '@modelcontextprotocol/server';

/**
 * Makes `server` skip registering any tool or prompt whose name the administrator disabled, so it
 * is neither listed nor callable in this session. Applied before any registration, it also covers
 * tools added later without each call site having to remember the check. Catalog operations are
 * additionally filtered by operationId in the server, and every execution rechecks the policy.
 */
export function withholdDisabledRegistrations(server: McpServer, disabled: ReadonlySet<string>) {
  const withheld = Object.freeze({
    enabled: false,
    enable() {},
    disable() {},
    remove() {},
    update() {},
  });
  const registerTool = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  const registerPrompt = server.registerPrompt.bind(server) as (...args: unknown[]) => unknown;
  Object.assign(server, {
    registerTool: (name: string, ...rest: unknown[]) =>
      disabled.has(name) ? withheld : registerTool(name, ...rest),
    registerPrompt: (name: string, ...rest: unknown[]) =>
      disabled.has(name) ? withheld : registerPrompt(name, ...rest),
  });
  return server;
}
