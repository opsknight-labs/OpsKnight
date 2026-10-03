import { describe, expect, it } from 'vitest';
import { redactRunbookOutput } from '@/lib/runbooks/redaction';

describe('runbook output redaction', () => {
  it('redacts known values and common credential formats', () => {
    const output = redactRunbookOutput(
      'password=hunter2 Authorization: Bearer abc123 api_key=key-value',
      ['hunter2']
    );
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('abc123');
    expect(output).not.toContain('key-value');
    expect(output).toContain('[REDACTED]');
  });

  it('bounds persisted previews by bytes', () => {
    expect(Buffer.byteLength(redactRunbookOutput('x'.repeat(40_000)))).toBeLessThanOrEqual(32_768);
  });
});
