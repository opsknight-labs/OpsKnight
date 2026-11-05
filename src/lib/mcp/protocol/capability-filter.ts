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

/**
 * Records the names of the tools and prompts actually registered on `server` (after any withheld
 * by withholdDisabledRegistrations), so later registrations can depend on earlier ones.
 */
export function recordRegistrations(server: McpServer) {
  const tools = new Set<string>();
  const prompts = new Set<string>();
  const registerTool = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  const registerPrompt = server.registerPrompt.bind(server) as (...args: unknown[]) => unknown;
  Object.assign(server, {
    registerTool: (name: string, ...rest: unknown[]) => {
      const handle = registerTool(name, ...rest) as { enabled?: boolean };
      if (handle?.enabled !== false) tools.add(name);
      return handle;
    },
    registerPrompt: (name: string, ...rest: unknown[]) => {
      const handle = registerPrompt(name, ...rest) as { enabled?: boolean };
      if (handle?.enabled !== false) prompts.add(name);
      return handle;
    },
  });
  return { tools, prompts };
}
