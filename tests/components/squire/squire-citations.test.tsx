import { describe, expect, it } from 'vitest';
import { distinctCitations } from '@/components/squire/SquireMessage';

const citation = (id: string, label: string) => ({
  kind: 'incident' as const,
  id,
  label,
  href: `/incidents/${id}`,
});

describe('distinctCitations', () => {
  it('drops repeated sources and tells same-titled incidents apart by short id', () => {
    const items = distinctCitations([
      citation('cmabc12345', 'Workflow failed: Tests'),
      citation('cmabc12345', 'Workflow failed: Tests'),
      citation('cmxyz67890', 'Workflow failed: Tests'),
      citation('cmqqq11111', 'Checkout latency'),
    ]);
    expect(items.map(item => [item.citation.id, item.ref])).toEqual([
      ['cmabc12345', '#12345'],
      ['cmxyz67890', '#67890'],
      ['cmqqq11111', null],
    ]);
  });
});
