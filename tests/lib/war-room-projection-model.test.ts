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
    expect(model.actions).toEqual(['ACKNOWLEDGE', 'ASSIGN_TO_ME', 'RESOLVE']);
    expect(renderSlackWarRoomProjection(model).blocks.at(-1)?.type).toBe('actions');
    expect(renderMicrosoftTeamsWarRoomProjection(model).actions).toHaveLength(3);
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
});
