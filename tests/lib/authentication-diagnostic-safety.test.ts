import { describe, expect, it } from 'vitest';
import { redactDiagnosticText } from '@/lib/auth-control/diagnostic-safety';
describe('diagnostic provider-error redaction', () => {
  it.each([
    'Bearer sensitive-value',
    'password=sensitive-value',
    '{"access_token":"sensitive-value"}',
    "'client_secret': 'sensitive-value with spaces'",
    'https://provider.example.test/callback?code=sensitive-value',
  ])('redacts %s', value => expect(redactDiagnosticText(value)).not.toContain('sensitive-value'));
  it('preserves an actionable explanation and bounds output', () => {
    expect(redactDiagnosticText('Provider unavailable; retry later.')).toBe(
      'Provider unavailable; retry later.'
    );
    expect(redactDiagnosticText('x'.repeat(1000))).toHaveLength(500);
  });
});
