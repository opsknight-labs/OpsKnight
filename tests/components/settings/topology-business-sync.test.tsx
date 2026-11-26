import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/(app)/settings/intelligence/response/actions', () => ({
  addTopologySourceAction: vi.fn(),
  importCatalogAction: vi.fn(),
  removeTopologySourceAction: vi.fn(),
  setTopologySourceBusinessSyncAction: vi.fn(),
  syncTopologySourceAction: vi.fn(),
}));

import { TopologySourceList, describeBusinessSync } from '@/components/settings/TopologyManager';

const summary = {
  status: 'OK' as const,
  created: 2,
  updated: 1,
  removed: ['Legacy'],
  skipped: [],
  unmatched: ['ghost-api'],
};

describe('topology source business-service sync', () => {
  it('summarizes a sync run and a failure', () => {
    expect(describeBusinessSync(summary)).toBe(
      'business services 2 created, 1 updated, 1 marked removed, 1 references unmatched'
    );
    expect(describeBusinessSync({ ...summary, status: 'FAILED', error: 'cycle' })).toBe(
      'business services not synced: cycle'
    );
  });

  it('shows the switches with the stored values to managers only', () => {
    const source = {
      id: 'src1',
      name: 'Backstage',
      url: 'https://backstage.example.com',
      enabled: true,
      intervalMinutes: 60,
      syncBusinessServices: true,
      syncDomains: false,
      lastSyncedAt: new Date('2026-11-26T10:00:00Z'),
      lastStatus: 'OK',
      lastSummary: { matched: 3, edgesDeclared: 2, unmatched: [], businessServices: summary },
    };
    const { rerender } = render(<TopologySourceList sources={[source]} canManage />);
    expect(screen.getByLabelText('Sync Systems as business services')).toBeChecked();
    expect(screen.getByLabelText('Include Domains')).not.toBeChecked();
    expect(screen.getByText(/business services 2 created/)).toBeInTheDocument();
    rerender(<TopologySourceList sources={[source]} canManage={false} />);
    expect(screen.queryByLabelText('Sync Systems as business services')).toBeNull();
  });
});
