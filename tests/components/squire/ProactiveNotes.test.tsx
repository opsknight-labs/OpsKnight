import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/squire/SquireMarkdown', () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

import { ProactiveNotes } from '@/components/incident/intelligence/ProactiveNotes';
import type { ProactiveNotesView } from '@/lib/intelligence/memory/proactive-view';

const notes: ProactiveNotesView = {
  briefing: null,
  postmortemDraft: null,
  nudge: {
    updatedAt: new Date('2026-11-23T10:00:00Z'),
    minutesSinceUpdate: 30,
    thresholdMinutes: 30,
    draft: 'We are investigating.',
    aiDraft: null,
  },
};

describe('ProactiveNotes', () => {
  it('uses the configured name and a unique heading per instance', () => {
    render(
      <>
        <ProactiveNotes incidentId="inc_1" notes={notes} assistantName="Pip" />
        <ProactiveNotes incidentId="inc_1" notes={notes} assistantName="Pip" />
      </>
    );
    const regions = screen.getAllByRole('region', { name: 'Pip' });
    expect(regions).toHaveLength(2);
    expect(regions[0].getAttribute('aria-labelledby')).not.toBe(
      regions[1].getAttribute('aria-labelledby')
    );
    expect(screen.getAllByRole('status')[0].className).toContain('bg-status-elevated-soft');
  });
});
