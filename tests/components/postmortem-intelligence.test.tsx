import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import {
  PostmortemActionSuggestions,
  PostmortemQualityChecklist,
  PostmortemRecurrenceStrip,
} from '@/components/postmortem/PostmortemIntelligence';
import type { ActionItemSuggestion } from '@/lib/intelligence/postmortems/evidence-draft';
import type { PostmortemRecurrence } from '@/lib/intelligence/postmortems/recurrence';

const recurrence: PostmortemRecurrence = {
  template: 'disk full on host-<num>',
  windowDays: 90,
  occurrences: 3,
  capped: false,
  previous: [
    {
      incidentId: 'inc-2',
      title: 'Disk full on host-7',
      createdAt: new Date('2026-10-02T10:00:00Z'),
    },
  ],
  lastPostmortem: {
    incidentId: 'inc-2',
    title: 'Disk exhaustion postmortem',
    status: 'PUBLISHED',
    createdAt: new Date('2026-10-03T10:00:00Z'),
  },
  openActionItems: [
    {
      id: 'ai-1',
      title: 'Add disk alerts',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: new Date('2026-10-20T00:00:00Z'),
      incidentId: 'inc-2',
      overdue: true,
    },
  ],
  openActionItemCount: 1,
  overdueActionItemCount: 1,
};

const suggestion = (over: Partial<ActionItemSuggestion> = {}): ActionItemSuggestion => ({
  key: 'cause:1',
  title: 'Add a pre-release check',
  description: 'The deploy preceded the incident.',
  priority: 'HIGH',
  source: 'ACCEPTED_CAUSE',
  duplicateOf: null,
  ...over,
});

describe('PostmortemRecurrenceStrip', () => {
  it('renders nothing without a recurrence', () => {
    const { container } = render(<PostmortemRecurrenceStrip recurrence={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links the last postmortem and lists overdue open action items', () => {
    render(<PostmortemRecurrenceStrip recurrence={recurrence} />);
    expect(screen.getByRole('region', { name: 'Recurrence' })).toHaveTextContent(
      /3 times in 90 days/
    );
    expect(screen.getByRole('link', { name: 'Disk exhaustion postmortem' })).toHaveAttribute(
      'href',
      '/postmortems/inc-2'
    );
    expect(screen.getByText(/1 action item still open, 1 overdue/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add disk alerts' })).toHaveAttribute(
      'href',
      '/postmortems/inc-2'
    );
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});

describe('PostmortemQualityChecklist', () => {
  it('is silent when complete and lists what is missing otherwise', () => {
    const { container, rerender } = render(<PostmortemQualityChecklist issues={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(
      <PostmortemQualityChecklist
        issues={[{ code: 'NO_ACTION_ITEMS', message: 'Add at least one action item.' }]}
      />
    );
    expect(screen.getByRole('region', { name: 'Postmortem checklist' })).toHaveTextContent(
      'Add at least one action item.'
    );
  });
});

describe('PostmortemActionSuggestions', () => {
  it('adds a suggestion only on click and shows a covered one as a link instead', () => {
    const onAdd = vi.fn();
    render(
      <PostmortemActionSuggestions
        suggestions={[
          suggestion(),
          suggestion({
            key: 'fix:2',
            title: 'Rotate logs',
            source: 'SIMILAR_FIX',
            duplicateOf: { id: 'ai-9', title: 'Rotate logs daily', incidentId: 'inc-2' },
          }),
        ]}
        onAdd={onAdd}
      />
    );
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add: Add a pre-release check' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ key: 'cause:1' }));
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Rotate logs daily' })).toHaveAttribute(
      'href',
      '/postmortems/inc-2'
    );
  });
});
