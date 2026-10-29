import { describe, expect, it } from 'vitest';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { friendlyMcpError, mcpErrorPage } from '@/lib/mcp/auth/friendly-error';
import { describeMcpScope } from '@/lib/mcp/auth/scopes';

describe('friendly MCP errors', () => {
  it('renders readable HTML with the right status and no-store headers', async () => {
    const response = mcpErrorPage(new McpBoundaryError('MCP_DISABLED', 503));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await response.text();
    expect(html).toContain('AI assistant access is turned off');
    expect(html).not.toContain('{"error"');
  });

  it('never echoes attacker-controlled input into the page', async () => {
    const hostile = '<script>alert(1)</script>';
    const response = mcpErrorPage(new McpBoundaryError(hostile, 400));
    const html = await response.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&#60;script&#62;');
  });

  it('does not resolve inherited object properties as messages', () => {
    for (const code of ['constructor', '__proto__', 'toString'])
      expect(friendlyMcpError(code).title).toMatch(/could not connect/i);
    expect(describeMcpScope('constructor:read')).toBe('View constructor');
  });

  it('falls back to a generic, actionable message for unknown failures', () => {
    expect(friendlyMcpError('something-new').title).toMatch(/could not connect/i);
    expect(mcpErrorPage(new Error('boom')).status).toBe(503);
  });
});

describe('scope descriptions', () => {
  it('uses plain language and flags that changes need approval', () => {
    expect(describeMcpScope('incidents:read')).toBe('View incidents');
    expect(describeMcpScope('schedules:read')).toBe('View on-call schedules');
    expect(describeMcpScope('runbooks:write')).toContain('administrator must approve');
    expect(describeMcpScope('custom_thing:read')).toBe('View custom thing');
  });
});
