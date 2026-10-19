import { describe, expect, it } from 'vitest';
import { redactRunbookOutput, redactRunbookEvidence } from '@/lib/runbooks/redaction';

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

it('sanitizes signed structured evidence and preserves operational measurements', () => {
  const result = redactRunbookEvidence({
    capturedAt: new Date().toISOString(),
    cpu: { load1: 2, cores: 4 },
    logSummary: 'https://app.test?access_token=opaque-query-secret',
    processes: 'DATABASE_PASSWORD="opaque app credential"',
  });
  expect(JSON.stringify(result)).not.toContain('opaque-query-secret');
  expect(JSON.stringify(result)).not.toContain('opaque app credential');
  expect(result).toMatchObject({ cpu: { load1: 2, cores: 4 } });
});
it('does not exceed the UTF-8 preview limit or split a codepoint', () => {
  const output = redactRunbookOutput('界'.repeat(20_000));
  expect(Buffer.byteLength(output)).toBeLessThanOrEqual(32768);
  expect(output).not.toContain('\uFFFD');
});
