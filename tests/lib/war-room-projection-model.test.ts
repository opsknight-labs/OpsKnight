import { describe, expect, it } from 'vitest';
import { buildWarRoomProjection } from '@/lib/war-room/projection-model';
import { renderSlackWarRoomProjection } from '@/lib/war-room/providers/slack/render';
import { renderMicrosoftTeamsWarRoomProjection } from '@/lib/war-room/providers/microsoft-teams/render';

const incident = {
  id: 'incident-1',
  title: 'Database latency',
  status: 'OPEN',
  urgency: 'HIGH',
  serviceName: 'Payments',
  url: 'https://example.test/incidents/incident-1',
  createdAt: new Date('2026-09-14T00:00:00Z'),
};

describe('provider-neutral war-room projection', () => {
  it('derives one semantic phase and action policy for every renderer', () => {
    const model = buildWarRoomProjection(incident);
    expect(model.phase).toBe('TRIGGERED');
    // RESOLVE is ACKNOWLEDGED-only (P1-8); TRIGGERED legacy is ACK + Assign (+ Take command)
    expect(model.actions).toEqual(['ACKNOWLEDGE', 'ASSIGN_SELF', 'TAKE_COMMAND']);
    expect(renderSlackWarRoomProjection(model).blocks.at(-1)?.type).toBe('actions');
    expect(renderMicrosoftTeamsWarRoomProjection(model).actions).toHaveLength(3);
  });

  it('shows Resolve only after acknowledgement (ACKNOWLEDGED phase)', () => {
    const ackModel = buildWarRoomProjection({
      ...incident,
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date('2026-09-14T01:00:00Z'),
    });
    expect(ackModel.phase).toBe('ACKNOWLEDGED');
    expect(ackModel.actions).toEqual(['ASSIGN_SELF', 'RESOLVE', 'TAKE_COMMAND']);
  });

  it('drops Take command once someone holds the commander role and shows the roles', () => {
    const model = buildWarRoomProjection({
      ...incident,
      roles: [
        { roleKey: 'COMMANDER', label: 'Incident commander', shortLabel: 'Commander', name: 'Ada' },
      ],
    });
    expect(model.actions).toEqual(['ACKNOWLEDGE', 'ASSIGN_SELF']);
    const slack = JSON.stringify(renderSlackWarRoomProjection(model).blocks);
    expect(slack).toContain('*Commander:* Ada');
    expect(slack).not.toContain('take_command');
  });

  it('removes mutation actions from terminal projections in both providers', () => {
    const model = buildWarRoomProjection({
      ...incident,
      status: 'RESOLVED',
      resolvedAt: new Date('2026-09-14T01:00:00Z'),
    });
    expect(model.phase).toBe('RESOLVED');
    expect(renderSlackWarRoomProjection(model).blocks.some(block => block.type === 'actions')).toBe(
      false
    );
    expect(renderMicrosoftTeamsWarRoomProjection(model).actions).toEqual([]);
  });

  it('maps Take command to one transport binding per provider', async () => {
    const { slackContractForKind, kindForSlackValue } = await import('@/lib/chatops/slack-action-map');
    const { chatOpsKindForTeamsVerb, teamsVerbForChatOpsKind } = await import(
      '@/lib/chatops/teams-action-map'
    );
    const { chatOpsCommandKindForActionKind } = await import('@/lib/chatops/action-contract');
    expect(slackContractForKind('TAKE_COMMAND')).toEqual({
      actionId: 'take_command_incident',
      actionValue: 'take_command',
      label: 'Take command',
    });
    expect(kindForSlackValue('take_command')).toBe('TAKE_COMMAND');
    expect(chatOpsKindForTeamsVerb(teamsVerbForChatOpsKind('TAKE_COMMAND'))).toBe('TAKE_COMMAND');
    expect(chatOpsCommandKindForActionKind('TAKE_COMMAND')).toBe('SET_ROLE');
  });
});
