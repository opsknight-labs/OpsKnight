import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunbookOverview, computeSuccessRate } from '@/components/runbooks/detail/RunbookOverview';
import {
  VersionTimeline,
  type VersionTimelineItem,
} from '@/components/runbooks/detail/VersionTimeline';
import { VersionStepDiff } from '@/components/runbooks/detail/VersionStepDiff';
import { RunbookDetailsSheet } from '@/components/runbooks/detail/RunbookDetailsSheet';
import { ImportRunbookDialog } from '@/components/runbooks/detail/ImportRunbookDialog';

vi.mock('@/app/(app)/runbooks/[id]/version-actions', () => ({ importRunbookAction: vi.fn() }));

const baseVersion: VersionTimelineItem = {
  id: 'ver_1',
  version: 1,
  state: 'PUBLISHED',
  isCurrentPublished: false,
  isCurrentDraft: false,
  publishedByLabel: 'Ada',
  publishedAtLabel: 'Oct 1, 2026',
  createdAtLabel: 'Sep 30, 2026',
  checksum: 'abcdef0123456789abcdef',
  executionCount: 3,
  pinnedRuleCount: 1,
  viewHref: '/runbooks/rb_1?version=ver_1&tab=builder',
  compareHref: '/runbooks/rb_1/compare?base=ver_1&next=ver_2',
};

describe('RunbookOverview', () => {
  it('computes success rate from completed runs only', () => {
    expect(computeSuccessRate(['SUCCEEDED', 'FAILED', 'RUNNING', 'SUCCEEDED'])).toEqual({
      succeeded: 2,
      completed: 3,
      sampled: 4,
    });
  });

  it('renders summary cards, top services and execution links', () => {
    render(
      <RunbookOverview
        runbookId="rb_1"
        publishedVersion={{ version: 2, publishedAtLabel: 'Oct 2, 2026' }}
        draftVersion={null}
        serviceCount={1}
        executionCount={4}
        lastExecution={{
          id: 'ex_1',
          status: 'SUCCEEDED',
          createdAtLabel: 'Oct 3, 2026',
          incidentId: null,
          version: 2,
        }}
        successRate={{ succeeded: 2, completed: 3, sampled: 4 }}
        services={[{ id: 'svc_1', name: 'Payments', ruleCount: 2 }]}
        recentExecutions={[
          {
            id: 'ex_1',
            status: 'SUCCEEDED',
            createdAtLabel: 'Oct 3, 2026',
            incidentId: 'inc_1',
            version: 2,
          },
        ]}
      />
    );
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('No open draft')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Payments/ })).toHaveAttribute(
      'href',
      '/services/svc_1?tab=runbooks'
    );
    const recent = screen.getByRole('region', { name: 'Recent executions' });
    expect(within(recent).getByRole('link', { name: /Oct 3, 2026/ })).toHaveAttribute(
      'href',
      '/runbooks/executions/ex_1'
    );
  });
});

describe('VersionTimeline', () => {
  it('shows version metadata and only the actions that were provided', () => {
    render(
      <VersionTimeline
        versions={[
          { ...baseVersion, id: 'ver_2', version: 2, isCurrentPublished: true, compareHref: null },
          { ...baseVersion, restoreAction: vi.fn(), retireAction: vi.fn() },
        ]}
      />
    );
    const items = within(screen.getByRole('list', { name: 'Version history' })).getAllByRole(
      'listitem'
    );
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Live')).toBeInTheDocument();
    expect(within(items[0]).queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(within(items[1]).getByText('abcdef012345')).toBeInTheDocument();
    expect(within(items[1]).getByText('3 executions')).toBeInTheDocument();
    expect(within(items[1]).getByText('1 pinned rule')).toBeInTheDocument();
    expect(within(items[1]).getByText(/Published Oct 1, 2026 by Ada/)).toBeInTheDocument();
    expect(within(items[1]).getByRole('link', { name: /Compare with published/ })).toHaveAttribute(
      'href',
      baseVersion.compareHref
    );
    expect(within(items[1]).getByRole('button', { name: 'Restore as draft' })).toBeInTheDocument();
    expect(within(items[1]).getByRole('button', { name: 'Retire' })).toBeInTheDocument();
  });
});

describe('VersionStepDiff', () => {
  it('shows changed steps with badges and collapses unchanged steps', () => {
    const side = { summary: 'Step · MANUAL · READ_ONLY', configuration: '{}' };
    render(
      <VersionStepDiff
        baseVersion={1}
        nextVersion={2}
        steps={[
          { key: 'added_step', change: 'ADDED', before: null, after: side },
          { key: 'removed_step', change: 'REMOVED', before: side, after: null },
          { key: 'changed_step', change: 'CHANGED', before: side, after: side },
          { key: 'same_step', change: 'UNCHANGED', before: side, after: side },
        ]}
      />
    );
    expect(screen.getByText('ADDED')).toBeInTheDocument();
    expect(screen.getByText('REMOVED')).toBeInTheDocument();
    expect(screen.getByText('CHANGED')).toBeInTheDocument();
    expect(screen.getByText('1 unchanged')).toBeInTheDocument();
    const details = screen.getByText('Show 1 unchanged step').closest('details');
    expect(details).not.toHaveAttribute('open');
  });
});

describe('RunbookDetailsSheet', () => {
  it('submits owner team and comma-separated tags', () => {
    render(
      <RunbookDetailsSheet
        runbook={{
          name: 'DB failover',
          slug: 'db-failover',
          description: '',
          ownerTeamId: 'team_1',
          tags: ['db', 'tier-1'],
        }}
        teams={[
          { id: 'team_1', name: 'Platform' },
          { id: 'team_2', name: 'Data' },
        ]}
        action={vi.fn()}
        archiveAction={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const owner = screen.getByLabelText('Owner team') as HTMLSelectElement;
    expect(owner.name).toBe('ownerTeamId');
    expect(owner.value).toBe('team_1');
    expect(within(owner).getByRole('option', { name: 'No owner team' })).toHaveValue('');
    const tags = screen.getByLabelText('Tags') as HTMLInputElement;
    expect(tags.name).toBe('tags');
    expect(tags.value).toBe('db, tier-1');
  });
});

describe('ImportRunbookDialog', () => {
  it('offers file upload and pasted JSON fields', () => {
    render(<ImportRunbookDialog action={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByRole('dialog', { name: 'Import runbook' })).toBeInTheDocument();
    expect(screen.getByLabelText('Runbook file')).toHaveAttribute('name', 'file');
    expect(screen.getByLabelText('Or paste JSON')).toHaveAttribute('name', 'json');
    expect(screen.getByRole('button', { name: 'Import runbook' })).toBeInTheDocument();
  });
});
