import { describe, expect, it } from 'vitest';
import {
  serializePublicPostmortem,
  type PublicPostmortemSource,
} from '@/lib/status-pages/public-postmortem';

const row = (id: string, title: string, description: string) => ({
  id,
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'MITIGATION',
  title,
  description,
  actor: 'Jane Responder',
});

const source = (timeline: unknown[]): PublicPostmortemSource => ({
  title: 'Postmortem: outage',
  status: 'PUBLISHED',
  isPublic: true,
  createdAt: new Date(),
  timeline,
  incident: { id: 'inc-1', title: 'Outage' },
});

describe('serializePublicPostmortem', () => {
  it('keeps auto-drafted internal notes, event messages and responder names off the public timeline', () => {
    const result = serializePublicPostmortem(
      source([
        row('draft-start', 'Incident Started', 'Incident created for Checkout'),
        row('draft-evt-1', 'Incident acknowledged by Jane Responder', 'Incident acknowledged by Jane Responder'),
        row('event-clx9abc', 'Incident acknowledged by Jane Responder', 'Incident acknowledged by Jane Responder'),
        row('event-clx9def', 'war-room chat', 'internal-chat: rotate the prod-db password'),
        row('draft-axis-0', 'Alert fired', 'captured war-room chat: rotate the prod-db password'),
        row('draft-run-clx1', 'Runbook Restart db', 'runbook output internal-chat'),
        row('draft-note-2', 'Note by Jane Responder', 'root cause is the prod-db password rotation'),
        row('note-3', 'Note by Deleted user', 'internal chatter'),
        row('manual-4', 'Note by Jane Responder', 'renamed row still carries the note title'),
        row('event-1767225600000', 'Rolled back release', 'Rolled back the 14:02 release'),
        row('draft-end', 'Incident Resolved', 'Incident marked as resolved.'),
      ])
    );
    expect(result.timeline?.map(entry => entry.title)).toEqual([
      'Incident Started',
      'Rolled back release',
      'Incident Resolved',
    ]);
    const json = JSON.stringify(result);
    for (const leaked of ['Jane', 'prod-db', 'internal-chat', 'internal chatter']) {
      expect(json).not.toContain(leaked);
    }
  });

  it('only emits the allowlisted fields, whatever else the stored row carries', () => {
    const stored = {
      ...source([]),
      id: 'pm-internal-id',
      actionItems: [{ title: 'Rotate prod-db password', owner: 'jane@example.test' }],
      createdBy: { id: 'u1', name: 'Jane Responder', email: 'jane@example.test' },
      impact: { usersAffected: 3, revenueImpact: 9000, slaBreaches: 2 },
    } as unknown as PublicPostmortemSource;
    const result = serializePublicPostmortem(stored);
    expect(Object.keys(result).sort()).toEqual(
      [
        'createdAt',
        'createdBy',
        'id',
        'incident',
        'isPublic',
        'lessons',
        'publishedAt',
        'resolution',
        'rootCause',
        'status',
        'summary',
        'title',
        'impact',
      ].sort()
    );
    expect(result.id).toBe('inc-1');
    expect(result.impact).toEqual({ usersAffected: 3 });
    const json = JSON.stringify(result);
    for (const leaked of ['Jane', 'jane@example.test', 'prod-db', 'pm-internal-id']) {
      expect(json).not.toContain(leaked);
    }
  });
});
