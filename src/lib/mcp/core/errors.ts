export class McpBoundaryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    /** Set only from a domain conflict's own retryability; never from free-form details. */
    public readonly retryable?: boolean
  ) {
    super(code);
  }
}

export function requireMcp(condition: unknown, code: string, status = 400): asserts condition {
  if (!condition) throw new McpBoundaryError(code, status);
}
