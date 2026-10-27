// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_LABELS,
  MAX_TEMPLATE_LENGTH,
  MAX_TOKENS,
  buildIncidentFingerprint,
  canonicalizeLabels,
  extractTokens,
  maskVolatileText,
} from '@/lib/intelligence/normalization';

describe('maskVolatileText', () => {
  it.each([
    ['Connection refused to 10.0.12.7:5432', 'connection refused to <ip>'],
    ['Request 3f2a9c1e-7b4d-4e8a-9a1b-2c5d6e7f8091 failed', 'request <uuid> failed'],
    ['Error at 2026-10-27T17:59:03.809+05:30 in worker', 'error at <ts> in worker'],
    ['Disk usage 93.5% on node-42', 'disk usage <num>% on node-<num>'],
    ['CPU > 90 for 15m', 'cpu > <num> for <num>m'],
    ['See https://grafana.example.com/d/abc?orgId=1&var=x', 'see <url>'],
    ['Alert for ops@example.com', 'alert for <email>'],
    ['commit deadbeef1234 deployed', 'commit <hex> deployed'],
  ])('masks volatile values in %j', (input, expected) => {
    expect(maskVolatileText(input)).toBe(expected);
  });

  it('collapses Kubernetes generated pod names to the workload', () => {
    expect(maskVolatileText('Pod checkout-api-7d9f8c6b5-x2k4p CrashLoopBackOff')).toBe(
      'pod checkout-api-<pod> crashloopbackoff'
    );
  });

  it('keeps plain words made only of hex letters readable', () => {
    expect(maskVolatileText('defaced feedback')).toBe('defaced feedback');
  });

  it('gives the same template for the same problem on different hosts and times', () => {
    const a = maskVolatileText('High latency on api-3 (10.1.2.3) at 2026-01-01T10:00:00Z');
    const b = maskVolatileText('High latency on api-17 (172.16.9.20) at 2026-03-09T22:41:11Z');
    expect(a).toBe(b);
  });

  it('keeps genuinely different problems distinct', () => {
    expect(maskVolatileText('Database connection errors')).not.toBe(
      maskVolatileText('Disk space low')
    );
  });

  it('is total for non-string input', () => {
    for (const value of [null, undefined, 42, {}, [], true]) expect(maskVolatileText(value)).toBe('');
  });

  it('is idempotent and bounded across many generated inputs', () => {
    let seed = 1234567;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed;
    };
    const alphabet = 'abcdef0123456789-_.:/@<> \tXYZ%';
    for (let i = 0; i < 400; i += 1) {
      const length = next() % 3000;
      let input = '';
      for (let j = 0; j < length; j += 1) input += alphabet[next() % alphabet.length];
      const once = maskVolatileText(input);
      expect(maskVolatileText(once)).toBe(once);
      expect(once.length).toBeLessThanOrEqual(MAX_TEMPLATE_LENGTH);
    }
  });

  it('stays fast on adversarial long inputs because input is truncated first', () => {
    const adversarial = [
      'a'.repeat(200_000),
      '1.'.repeat(100_000),
      `${'a-'.repeat(50_000)}!`,
      `${'a@'.repeat(50_000)}`,
      `${'0'.repeat(100_000)}x`,
      'https://'.repeat(30_000),
    ];
    const started = performance.now();
    for (const input of adversarial) maskVolatileText(input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('extractTokens', () => {
  it('returns sorted unique content words without placeholders or stop words', () => {
    expect(extractTokens('connection refused to <ip> and connection reset <num>')).toEqual([
      'connection',
      'refused',
      'reset',
    ]);
  });

  it('is capped', () => {
    const many = Array.from({ length: 500 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0) % 26)}`).join(' ');
    expect(extractTokens(many).length).toBeLessThanOrEqual(MAX_TOKENS);
  });
});

describe('canonicalizeLabels', () => {
  it('flattens, lowercases and sorts keys deterministically', () => {
    const labels = canonicalizeLabels({ Service: 'Checkout', env: 'PROD', k8s: { Namespace: 'Payments' } });
    expect(Object.keys(labels)).toEqual(['env', 'k8s.namespace', 'service']);
    expect(labels).toEqual({ env: 'prod', 'k8s.namespace': 'payments', service: 'checkout' });
  });

  it('never keeps credentials by key or by shape', () => {
    const labels = canonicalizeLabels({
      password: 'hunter2',
      api_key: 'abc',
      nested: { Authorization: 'Bearer xyz', session_id: '1' },
      note: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      region: 'eu-west-1',
    });
    expect(labels).toEqual({ region: 'eu-west-1' });
  });

  it('ignores arrays, nulls and non-objects and never throws', () => {
    expect(canonicalizeLabels(null)).toEqual({});
    expect(canonicalizeLabels('text')).toEqual({});
    expect(canonicalizeLabels({ list: [1, 2], none: null, ok: 1 })).toEqual({ ok: '1' });
  });

  it('bounds the number and size of labels and handles deep or hostile structures', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`key${i}`, 'long value '.repeat(100)])
    );
    const labels = canonicalizeLabels(wide);
    expect(Object.keys(labels).length).toBe(MAX_LABELS);
    expect(Object.values(labels).every(value => value.length <= 128)).toBe(true);

    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 10_000; i += 1) deep = { child: deep };
    expect(canonicalizeLabels(deep)).toEqual({});
  });
});

describe('buildIncidentFingerprint', () => {
  it('derives template from the title, tokens from title and description, and safe labels', () => {
    const fingerprint = buildIncidentFingerprint({
      title: 'DB connection errors on checkout-api-7d9f8c6b5-x2k4p',
      description: 'Pool exhausted at 2026-10-27T10:00:00Z',
      labelSource: { service: 'Checkout', token: 'secret' },
    });
    expect(fingerprint.template).toBe('db connection errors on checkout-api-<pod>');
    expect(fingerprint.tokens).toEqual([
      'api',
      'checkout',
      'connection',
      'db',
      'errors',
      'exhausted',
      'pool',
    ]);
    expect(fingerprint.labels).toEqual({ service: 'checkout' });
  });

  it('does not let description churn change the template', () => {
    const a = buildIncidentFingerprint({ title: 'Disk full', description: 'volume a' });
    const b = buildIncidentFingerprint({ title: 'Disk full', description: 'something else entirely' });
    expect(a.template).toBe(b.template);
  });
});
