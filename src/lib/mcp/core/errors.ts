export class McpBoundaryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400
  ) {
    super(code);
  }
}

export function requireMcp(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new McpBoundaryError(code, status);
}
