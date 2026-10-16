import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RunbookLibrary, { CreateRunbookDialog } from '@/components/runbooks/RunbookLibrary';
import { ImportRunbookDialog } from '@/components/runbooks/detail/ImportRunbookDialog';
import { RunbookCard } from '@/components/runbooks/library/RunbookCard';

vi.mock('@/app/(app)/runbooks/actions', () => ({
  createRunbookAction: vi.fn(),
  importRunbookAction: vi.fn(),
}));

describe('RunbookLibrary and related components', () => {
  const sampleRunbook = {
    id: 'cmvai5hyw00027f8qszjvm4hr',
    name: 'Linux service recovery',
    description: 'Capture diagnostics, restart a systemd unit with approval, then verify.',
    publishedVersion: 1,
    draftVersion: 2,
    bindings: 2,
    executions: 5,
    sampleServices: ['Payment Gateway', 'Auth Service'],
    ownerTeam: { id: 'team_1', name: 'Infrastructure' },
    tags: ['linux', 'production'],
    lastExecution: {
      id: 'exec_1',
      status: 'SUCCEEDED',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    archivedAt: null,
    updatedAt: new Date().toISOString(),
  };

  it('renders RunbookCard properly with tags, status, and metadata', () => {
    render(<RunbookCard runbook={sampleRunbook} userTimeZone="UTC" density="grid" />);
    expect(screen.getByText('Linux service recovery')).toBeDefined();
    expect(screen.getByText('Infrastructure')).toBeDefined();
    expect(screen.getByText('linux')).toBeDefined();
  });

  it('renders RunbookLibrary with list of runbooks', () => {
    render(
      <RunbookLibrary
        runbooks={[sampleRunbook]}
        canManage={true}
        userTimeZone="UTC"
        total={1}
        teams={[{ id: 'team_1', name: 'Infrastructure' }]}
      />
    );
    expect(screen.getByText('Linux service recovery')).toBeDefined();
  });

  it('renders CreateRunbookDialog without errors', () => {
    render(<CreateRunbookDialog teams={[{ id: 'team_1', name: 'Infrastructure' }]} />);
    expect(screen.getByRole('button', { name: /new runbook/i })).toBeDefined();
  });

  it('renders ImportRunbookDialog without errors', () => {
    render(<ImportRunbookDialog />);
    expect(screen.getByRole('button', { name: /import/i })).toBeDefined();
  });
});
