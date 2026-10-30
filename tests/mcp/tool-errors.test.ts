import { describe, expect, it } from 'vitest';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { validateOperationArgs } from '@/lib/mcp/core/execution';
import { toolErrorText } from '@/lib/mcp/protocol/server';

const caught = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected a failure');
};

describe('tool error text', () => {
  it('keeps a bare code bare and passes a domain conflict retryability through', () => {
    expect(toolErrorText(new McpBoundaryError('MCP_RESOURCE_UNAVAILABLE', 404))).toBe(
      'MCP_RESOURCE_UNAVAILABLE'
    );
    expect(toolErrorText(new McpBoundaryError('MCP_DOMAIN_REJECTED', 409, true))).toBe(
      'MCP_DOMAIN_REJECTED: Retryable.'
    );
    expect(toolErrorText(new McpBoundaryError('MCP_DOMAIN_REJECTED', 409, false))).toBe(
      'MCP_DOMAIN_REJECTED: Not retryable.'
    );
    expect(toolErrorText(new Error('internal detail'))).toBe('MCP_UNAVAILABLE');
  });

  it('points an unknown operation at search_capabilities', () => {
    const error = caught(() => validateOperationArgs('listServicez', {}));
    expect(toolErrorText(error)).toBe(
      'MCP_OPERATION_UNAVAILABLE: Unknown or unavailable operationId; use search_capabilities to find one.'
    );
  });

  it('names the offending field, never its value', () => {
    const error = caught(() =>
      validateOperationArgs('listServices', { query: { bogus: 'secret-value' } })
    );
    const text = toolErrorText(error);
    expect(text).toMatch(/^MCP_INVALID_ARGUMENTS: \/query .*\(bogus\)/);
    expect(text).not.toContain('secret-value');
    const typed = toolErrorText(
      caught(() => validateOperationArgs('listServices', { query: { limit: 'secret-value' } }))
    );
    expect(typed).toContain('/query/limit must be integer');
    expect(typed).not.toContain('secret-value');
  });
});
