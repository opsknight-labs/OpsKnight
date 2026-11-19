import { describe, expect, it } from 'vitest';
import { rankAttention, type AttentionItem } from '@/lib/intelligence/overview/attention-contract';

const probe = (id: string, kind: AttentionItem['kind'], at?: string): AttentionItem => ({
  id,
  kind,
  title: id,
  detail: '',
  href: '/',
  ...(at ? { at: new Date(at) } : {}),
});
const insight = (id: string, severity: 'INFO' | 'WARNING' | 'CRITICAL', at: string) => ({
  id,
  severity,
  lastSeenAt: new Date(at),
});

describe('rankAttention', () => {
  it('merges both sources by severity, then newest first, undated rows last', () => {
    const ranked = rankAttention(
      [
        probe('gate', 'gate'),
        probe('triage', 'triage', '2026-11-10T00:00:00Z'),
        probe('quarantine', 'quarantine'),
      ],
      [
        insight('info-new', 'INFO', '2026-11-12T00:00:00Z'),
        insight('crit', 'CRITICAL', '2026-11-01T00:00:00Z'),
        insight('warn-new', 'WARNING', '2026-11-11T00:00:00Z'),
        insight('warn-old', 'WARNING', '2026-11-02T00:00:00Z'),
      ]
    );
    expect(ranked.map(row => row.id)).toEqual([
      'crit',
      'warn-new',
      'triage',
      'warn-old',
      'quarantine',
      'info-new',
      'gate',
    ]);
    expect(ranked[2]).toMatchObject({ type: 'probe', severity: 'WARNING' });
    expect(ranked[0]).toMatchObject({ type: 'insight', severity: 'CRITICAL' });
  });

  it('is empty when both sources are', () => {
    expect(rankAttention([], [])).toEqual([]);
  });
});
