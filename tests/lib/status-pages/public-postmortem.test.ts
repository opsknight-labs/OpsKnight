import { describe, expect, it } from 'vitest';
import { serializePublicPostmortem } from '@/lib/status-pages/public-postmortem';

const row = (id: string, title: string, description: string) => ({
  id,
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'MITIGATION',
  title,
  description,
  actor: 'Jane Responder',
});

describe('serializePublicPostmortem', () => {
  it('keeps auto-drafted internal notes and responder names off the public timeline', () => {
    const result = serializePublicPostmortem({
      title: 'Postmortem: outage',
      status: 'PUBLISHED',
      isPublic: true,
      createdAt: new Date(),
      incident: { id: 'inc-1', title: 'Outage' },
      timeline: [
        row('draft-evt-1', 'Database failed over', 'Database failed over'),
        row('draft-note-2', 'Note by Jane Responder', 'root cause is the prod-db password rotation'),
        row('note-3', 'Note by Deleted user', 'internal chatter'),
        row('manual-4', 'Note by Jane Responder', 'renamed row still carries the note title'),
      ],
    });
    expect(result.timeline?.map(entry => entry.title)).toEqual(['Database failed over']);
    expect(JSON.stringify(result)).not.toContain('Jane');
    expect(JSON.stringify(result)).not.toContain('prod-db');
  });
});
