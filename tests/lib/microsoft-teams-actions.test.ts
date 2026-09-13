import { describe, expect, it } from 'vitest';
import { parseMicrosoftTeamsAction, TEAMS_CHATOPS_VERBS } from '@/lib/microsoft-teams/action-schema';
import { teamsActionError, teamsActionSuccess } from '@/lib/microsoft-teams/invoke-response';

const context = { v: 2, incidentId: 'inc-1', destinationId: 'dest-1', messageGeneration: 1 };

describe('Microsoft Teams Action.Execute contract', () => {
  it.each(Object.values(TEAMS_CHATOPS_VERBS))('accepts the registered verb %s', verb => {
    const extra = verb === TEAMS_CHATOPS_VERBS.NOTE ? { note: 'hello' }
      : verb === TEAMS_CHATOPS_VERBS.PRIORITY ? { priority: 'P2' }
        : verb === TEAMS_CHATOPS_VERBS.SNOOZE ? { minutes: '30' } : {};
    const action = parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb, data: { ...context, ...extra } } });
    expect(action.action.verb).toBe(verb);
  });

  it('rejects unknown fields and unregistered verbs', () => {
    expect(() => parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: 'evil', data: context } })).toThrow();
    expect(() => parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: TEAMS_CHATOPS_VERBS.ACK, data: { ...context, userId: 'admin' } } })).toThrow();
  });

  it('enforces server-side note, priority, snooze and generation bounds', () => {
    expect(() => parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: TEAMS_CHATOPS_VERBS.NOTE, data: { ...context, note: 'x'.repeat(2001) } } })).toThrow();
    expect(() => parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: TEAMS_CHATOPS_VERBS.PRIORITY, data: { ...context, priority: 'P9' } } })).toThrow();
    expect(() => parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: TEAMS_CHATOPS_VERBS.SNOOZE, data: { ...context, minutes: 0 } } })).toThrow();
    expect(() => parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: TEAMS_CHATOPS_VERBS.ACK, data: { ...context, messageGeneration: 0 } } })).toThrow();
  });

  it('uses Bot Framework invoke response envelopes', () => {
    expect(teamsActionSuccess('Done')).toEqual({ statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: 'Done' });
    expect(teamsActionError(403, 'Denied', 'No')).toMatchObject({ statusCode: 403, type: 'application/vnd.microsoft.error', value: { code: 'Denied' } });
  });
});
