import { describe, expect, it } from 'vitest';
import {
  parseMicrosoftTeamsAction,
  TEAMS_CHATOPS_VERBS,
} from '@/lib/microsoft-teams/action-schema';
import { teamsActionError, teamsActionSuccess } from '@/lib/microsoft-teams/invoke-response';

const context = { v: 2, incidentId: 'inc-1', destinationId: 'dest-1', messageGeneration: 1 };

describe('Microsoft Teams Action.Execute contract', () => {
  it.each(Object.values(TEAMS_CHATOPS_VERBS))('accepts the registered verb %s', verb => {
    const extra =
      verb === TEAMS_CHATOPS_VERBS.NOTE
        ? { note: 'hello' }
        : verb === TEAMS_CHATOPS_VERBS.PRIORITY
          ? { priority: 'P2' }
          : verb === TEAMS_CHATOPS_VERBS.SNOOZE
            ? { minutes: '30' }
            : {};
    const action = parseMicrosoftTeamsAction({
      action: { type: 'Action.Execute', verb, data: { ...context, ...extra } },
    });
    expect(action.action.verb).toBe(verb);
  });

  it('rejects unknown fields and unregistered verbs', () => {
    expect(() =>
      parseMicrosoftTeamsAction({ action: { type: 'Action.Execute', verb: 'evil', data: context } })
    ).toThrow();
    expect(() =>
      parseMicrosoftTeamsAction({
        action: {
          type: 'Action.Execute',
          verb: TEAMS_CHATOPS_VERBS.ACK,
          data: { ...context, userId: 'admin' },
        },
      })
    ).toThrow();
  });

  it('enforces server-side note, priority, snooze and generation bounds', () => {
    expect(() =>
      parseMicrosoftTeamsAction({
        action: {
          type: 'Action.Execute',
          verb: TEAMS_CHATOPS_VERBS.NOTE,
          data: { ...context, note: 'x'.repeat(2001) },
        },
      })
    ).toThrow();
    expect(() =>
      parseMicrosoftTeamsAction({
        action: {
          type: 'Action.Execute',
          verb: TEAMS_CHATOPS_VERBS.PRIORITY,
          data: { ...context, priority: 'P9' },
        },
      })
    ).toThrow();
    expect(() =>
      parseMicrosoftTeamsAction({
        action: {
          type: 'Action.Execute',
          verb: TEAMS_CHATOPS_VERBS.SNOOZE,
          data: { ...context, minutes: 0 },
        },
      })
    ).toThrow();
    expect(() =>
      parseMicrosoftTeamsAction({
        action: {
          type: 'Action.Execute',
          verb: TEAMS_CHATOPS_VERBS.ACK,
          data: { ...context, messageGeneration: 0 },
        },
      })
    ).toThrow();
  });

  it('uses Bot Framework invoke response envelopes', () => {
    expect(teamsActionSuccess('Done')).toEqual({
      statusCode: 200,
      type: 'application/vnd.microsoft.activity.message',
      value: 'Done',
    });
    expect(teamsActionError(403, 'Denied', 'No')).toMatchObject({
      statusCode: 403,
      type: 'application/vnd.microsoft.error',
      value: { code: 'Denied' },
    });
  });

  it('accepts real Teams client metadata in envelope and action (state, null id, action title, inputs)', () => {
    const refreshPayload = {
      action: {
        type: 'Action.Execute',
        id: null,
        verb: TEAMS_CHATOPS_VERBS.REFRESH,
        data: context,
        title: 'Refresh',
        associatedInputs: 'none',
        mode: 'secondary',
      },
      trigger: 'automatic',
      state: 'client-token-state',
      inputs: {},
    };
    const parsed = parseMicrosoftTeamsAction(refreshPayload);
    expect(parsed.action.verb).toBe(TEAMS_CHATOPS_VERBS.REFRESH);
    expect(parsed.data.incidentId).toBe('inc-1');
  });

  it('handles JSON stringified value and stringified action.data', () => {
    const stringifiedData = {
      action: {
        type: 'Action.Execute',
        verb: TEAMS_CHATOPS_VERBS.ACK,
        data: JSON.stringify(context),
      },
    };
    const parsed = parseMicrosoftTeamsAction(stringifiedData);
    expect(parsed.action.verb).toBe(TEAMS_CHATOPS_VERBS.ACK);
    expect(parsed.data.incidentId).toBe('inc-1');

    const entirelyStringified = JSON.stringify(stringifiedData);
    const parsedAll = parseMicrosoftTeamsAction(entirelyStringified);
    expect(parsedAll.action.verb).toBe(TEAMS_CHATOPS_VERBS.ACK);
  });

  it('merges card inputs into data when inputs object is present', () => {
    const payload = {
      action: {
        type: 'Action.Execute',
        verb: TEAMS_CHATOPS_VERBS.NOTE,
        data: context,
      },
      inputs: {
        note: 'Submitted from card input',
      },
    };
    const parsed = parseMicrosoftTeamsAction(payload);
    expect(parsed.action.verb).toBe(TEAMS_CHATOPS_VERBS.NOTE);
    expect((parsed.data as unknown as { note: string }).note).toBe('Submitted from card input');
  });

  it('accepts real-world Teams production payload with trigger and isRefresh inside action.data', () => {
    const productionPayload = {
      action: {
        type: 'Action.Execute',
        verb: TEAMS_CHATOPS_VERBS.REFRESH,
        data: {
          v: 2,
          incidentId: 'cmu6wp24f001t11t3isuxhm04',
          destinationId: 'cmu5qqzrn00024wvwf0rgwm9o',
          messageGeneration: 1,
          warRoomId: 'cmu6wp3bo002i11t3cbuab12x',
          trigger: 'automatic',
          isRefresh: true,
        },
      },
      trigger: 'automatic',
    };
    const parsed = parseMicrosoftTeamsAction(productionPayload);
    expect(parsed.action.verb).toBe(TEAMS_CHATOPS_VERBS.REFRESH);
    expect(parsed.data.incidentId).toBe('cmu6wp24f001t11t3isuxhm04');
    expect(parsed.data.warRoomId).toBe('cmu6wp3bo002i11t3cbuab12x');
  });
});
