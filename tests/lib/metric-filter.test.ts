import { describe, expect, it } from 'vitest';
import { compileIncidentMetricFilter } from '@/lib/metrics/domain/filter';

describe('canonical incident metric filter', () => {
  it('compiles priority and scalar predicates into both Prisma and SQL', () => {
    const compiled = compileIncidentMetricFilter({
      priority: ['P2', 'P1', 'P1'],
      urgency: 'HIGH',
      status: 'ACTIVE',
      visibility: 'PRIVATE',
    });
    expect(compiled.prisma).toMatchObject({
      priority: { in: ['P1', 'P2'] },
      urgency: 'HIGH',
      visibility: 'PRIVATE',
    });
    expect(compiled.sql.strings.join(' ')).toContain('"priority"');
    expect(compiled.sql.values).toContainEqual(['P1', 'P2']);
    expect(compiled.identity.priorities).toEqual(['P1', 'P2']);
  });

  it('keeps scope OR semantics identical for service, team and assignee', () => {
    const compiled = compileIncidentMetricFilter(
      { serviceId: 'svc', teamId: 'team', assigneeId: null, useOrScope: true },
      'i'
    );
    expect(compiled.prisma.OR).toHaveLength(3);
    expect(compiled.sql.strings.join(' ')).toContain(' OR ');
    expect(compiled.sql.strings.join(' ')).toContain('i."assigneeId" IS NULL');
    expect(compiled.identity).toMatchObject({ scope: 'or', assignee: null });
  });

  it('ANDs immutable actor authorization with user-selected filters in Prisma and SQL', () => {
    const compiled = compileIncidentMetricFilter({
      serviceId: 'selected-service',
      status: 'OPEN',
      authorizationScope: { actorId: 'actor-1', teamIds: ['team-2', 'team-1'] },
    });

    expect(compiled.prisma.AND).toHaveLength(2);
    expect(compiled.prisma.AND).toContainEqual({
      OR: [
        { assigneeId: 'actor-1' },
        { watchers: { some: { userId: 'actor-1' } } },
        {
          AND: [
            { visibility: 'PUBLIC' },
            {
              OR: [
                { teamId: { in: ['team-1', 'team-2'] } },
                { service: { teamId: { in: ['team-1', 'team-2'] } } },
              ],
            },
          ],
        },
      ],
    });
    expect(compiled.sql.strings.join(' ')).toContain('"IncidentWatcher"');
    expect(compiled.sql.values).toContain('actor-1');
    expect(compiled.identity.authorization).toBe('actor-1:team-1,team-2');
  });
});
