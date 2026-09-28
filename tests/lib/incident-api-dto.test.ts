import { describe, expect, it } from 'vitest';
import { toIncidentApiDto, toIncidentApiDtos } from '@/lib/incidents/api-dto';

describe('incident API DTO', () => {
  it('converts every Prisma BigInt duration to a JSON-safe number', () => {
    const dto = toIncidentApiDto({
      id: 'incident-1',
      slaPausedMs: BigInt(12),
      slaAckElapsedMs: BigInt(34),
      slaResolveElapsedMs: null,
    });

    expect(dto).toEqual({
      id: 'incident-1',
      slaPausedMs: 12,
      slaAckElapsedMs: 34,
      slaResolveElapsedMs: null,
    });
    expect(() => JSON.stringify(dto)).not.toThrow();
  });

  it('serializes incident collections and preserves related records', () => {
    const [dto] = toIncidentApiDtos([
      { id: 'incident-1', service: { id: 'service-1' }, slaPausedMs: BigInt(0) },
    ]);

    expect(dto).toMatchObject({
      id: 'incident-1',
      service: { id: 'service-1' },
      slaPausedMs: 0,
    });
  });

  it('fails closed instead of silently losing precision', () => {
    expect(() =>
      toIncidentApiDto({
        id: 'incident-1',
        slaPausedMs: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
      })
    ).toThrow(/JSON-safe integer range/);
  });
});
