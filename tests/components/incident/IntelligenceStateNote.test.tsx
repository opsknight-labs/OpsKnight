import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { incidentStateNote } from '@/lib/intelligence/incident-ux/state-note';

vi.mock('@/app/(app)/incidents/[id]/intelligence-actions', () => ({
  summarizeIncidentAction: vi.fn(async () => ({ status: 'idle' })),
}));
vi.mock('@/components/incident/intelligence/PostSummaryAsNoteButton', () => ({
  default: () => null,
}));
const { default: IntelligenceStateNote } =
  await import('@/components/incident/intelligence/IntelligenceStateNote');

describe('incidentStateNote', () => {
  it('says Intelligence is off and gives an administrator the way to turn it on', () => {
    expect(incidentStateNote('OFF', true)).toMatchObject({
      kind: 'off',
      action: { label: 'Turn on', href: '/settings/intelligence/setup' },
    });
  });

  it('tells everyone else to ask, with no link they cannot open', () => {
    const note = incidentStateNote('OFF', false);
    expect(note).toMatchObject({ kind: 'off', action: null });
    expect((note as { text: string }).text).toMatch(/Ask an administrator/);
  });

  it('says it is only watching, so a blank card is not mistaken for nothing found', () => {
    expect(incidentStateNote('SHADOW', true)).toMatchObject({
      kind: 'watching',
      text: expect.stringMatching(/watching this incident/),
      action: { href: '/settings/intelligence' },
    });
    expect(incidentStateNote('SHADOW', false)).toMatchObject({ kind: 'watching', action: null });
  });

  it('offers the on-request summary once suggestions are on', () => {
    expect(incidentStateNote('SUGGEST', false)).toEqual({ kind: 'summary' });
    expect(incidentStateNote('AUTO', true)).toEqual({ kind: 'summary' });
  });
});

describe('IntelligenceStateNote', () => {
  const props = { incidentId: 'inc_1', canPostNote: false };

  it('is a note with a Turn on link for an administrator when Intelligence is off', () => {
    render(<IntelligenceStateNote {...props} mode="OFF" canManage />);
    expect(screen.getByRole('note')).toHaveTextContent('Intelligence is off for this service');
    expect(screen.getByRole('link', { name: 'Turn on' })).toHaveAttribute(
      'href',
      '/settings/intelligence/setup'
    );
  });

  it('shows no link to someone who cannot manage', () => {
    render(<IntelligenceStateNote {...props} mode="OFF" canManage={false} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the Summarise card, generated only on request, when suggestions are on', () => {
    render(<IntelligenceStateNote {...props} mode="SUGGEST" canManage={false} />);
    expect(screen.getByRole('button', { name: 'Summarise this incident' })).toBeInTheDocument();
  });
});
