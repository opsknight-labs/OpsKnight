import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { mcpIfMatch } from '@/lib/mcp/core/execution';

describe('mcpIfMatch', () => {
  it('keeps a strong ETag and quotes a bare revision', () => {
    expect(mcpIfMatch('"3"')).toBe('"3"');
    expect(mcpIfMatch('3')).toBe('"3"');
    expect(mcpIfMatch(' 12 ')).toBe('"12"');
  });

  it.each(['W/"3"', '"3', 'abc', '"3","4"', '*', '', '12345678901'])(
    'refuses %j up front with a usable hint',
    value => {
      expect(() => mcpIfMatch(value)).toThrow(
        expect.objectContaining({ code: 'MCP_INVALID_ARGUMENTS' })
      );
      try {
        mcpIfMatch(value);
      } catch (error) {
        expect(String((error as { hint?: string }).hint)).toContain('revision');
      }
    }
  );
});
