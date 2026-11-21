import { describe, expect, it } from 'vitest';
import {
  buildNotificationEnvelope,
  decodeNotificationEnvelope,
  encodeNotificationEnvelope,
  pageContextLines,
  parsePageContext,
} from '@/lib/notification-payload';

const incident = (pageContext: unknown) => ({
  id: 'inc_1',
  title: 'API down',
  createdAt: new Date('2026-11-17T10:00:00Z'),
  updatedAt: new Date('2026-11-17T10:00:00Z'),
  pageContext,
});
const at = new Date('2026-11-17T10:01:00Z');

describe('page context in notification envelopes', () => {
  it('carries the stored leads on a page and survives the durable round trip', () => {
    const envelope = buildNotificationEnvelope(
      incident({ similarIncidentId: 'inc_old', changeId: 'chg_1', runbookId: 'rb_1' }),
      'triggered',
      at,
      'paged'
    );
    const decoded = decodeNotificationEnvelope(encodeNotificationEnvelope(envelope));
    expect(decoded?.snapshot.context).toEqual({
      similarIncidentId: 'inc_old',
      changeId: 'chg_1',
      runbookId: 'rb_1',
    });
  });

  it('leaves it off acknowledgements, resolutions and incidents without leads', () => {
    const leads = { changeId: 'chg_1' };
    for (const eventType of ['acknowledged', 'resolved'] as const)
      expect(
        buildNotificationEnvelope(incident(leads), eventType, at, 'x').snapshot
      ).not.toHaveProperty('context');
    expect(
      buildNotificationEnvelope(incident(null), 'triggered', at, 'x').snapshot
    ).not.toHaveProperty('context');
  });

  it('keeps only short plain ids from the stored JSON', () => {
    expect(
      parsePageContext({ changeId: 'chg_1', runbookId: 'rb 1?x=y', similarIncidentId: 7 })
    ).toEqual({ changeId: 'chg_1' });
    expect(parsePageContext({ runbookId: 'x'.repeat(65) })).toBeNull();
    expect(parsePageContext(['chg_1'])).toBeNull();
    expect(parsePageContext('chg_1')).toBeNull();
  });

  it('renders a labelled link per lead', () => {
    expect(
      pageContextLines({ similarIncidentId: 'inc_old', runbookId: 'rb_1' }, 'https://ops.example')
    ).toEqual([
      { label: 'Similar past incident', value: 'https://ops.example/incidents/inc_old' },
      { label: 'Suggested runbook', value: 'https://ops.example/runbooks/rb_1' },
    ]);
    expect(pageContextLines(null, 'https://ops.example')).toEqual([]);
  });
});
