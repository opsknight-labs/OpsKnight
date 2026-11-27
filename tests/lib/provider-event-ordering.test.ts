import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import {
  findStaleProviderEvent,
  providerEventTimeMs,
} from '@/lib/incidents/provider-event-time';

type StoredAlert = { status: string; payload: unknown };

function txWith(alerts: StoredAlert[]) {
  const findMany = vi.fn(async () => alerts);
  return { tx: { alert: { findMany } } as unknown as Prisma.TransactionClient, findMany };
}

const cw = (time: string) => ({ stateChangeTime: time, state: 'ALARM' });
const stored = (status: 'TRIGGERED' | 'RESOLVED', details: unknown): StoredAlert => ({
  status,
  payload: { summary: 'x', custom_details: details },
});
const check = (
  tx: Prisma.TransactionClient,
  action: 'trigger' | 'resolve',
  details: unknown,
  integrationType = 'CLOUDWATCH'
) =>
  findStaleProviderEvent(tx, {
    serviceId: 'svc',
    dedupKeys: ['cloudwatch-1-us-east-1-HighCPU'],
    integrationType,
    action,
    details,
  });

describe('providerEventTimeMs', () => {
  it('reads each provider time and ignores unusable values', () => {
    expect(providerEventTimeMs('CLOUDWATCH', 'trigger', cw('2026-11-08T10:00:00.000+0000'))).toBe(
      Date.parse('2026-11-08T10:00:00Z')
    );
    expect(
      providerEventTimeMs('AZURE', 'resolve', {
        firedDateTime: '2026-11-08T10:00:00Z',
        resolvedDateTime: '2026-11-08T10:30:00Z',
      })
    ).toBe(Date.parse('2026-11-08T10:30:00Z'));
    expect(
      providerEventTimeMs('GOOGLE_CLOUD_MONITORING', 'trigger', { incident: { started_at: 1_794_132_000 } })
    ).toBe(1_794_132_000_000);
    expect(
      providerEventTimeMs('GRAFANA', 'resolve', { endsAt: '0001-01-01T00:00:00Z' })
    ).toBeNull();
    expect(providerEventTimeMs('CLOUDWATCH', 'trigger', { stateChangeTime: 'soon' })).toBeNull();
  });

  it('returns null for a provider with no usable ordering time', () => {
    expect(providerEventTimeMs('DATADOG', 'trigger', { date_happened: 1_794_132_000 })).toBeNull();
    expect(providerEventTimeMs('WEBHOOK', 'trigger', null)).toBeNull();
  });
});

describe('findStaleProviderEvent', () => {
  const resolvedAt = '2026-11-08T10:30:00.000Z';
  const firedAt = '2026-11-08T10:00:00.000Z';

  it('ignores a late trigger that arrives after the resolve', async () => {
    const { tx } = txWith([stored('RESOLVED', cw(resolvedAt)), stored('TRIGGERED', cw(firedAt))]);
    const stale = await check(tx, 'trigger', cw(firedAt));
    expect(stale).toEqual({
      incomingMs: Date.parse(firedAt),
      lastAcceptedMs: Date.parse(resolvedAt),
    });
  });

  it('ignores a late resolve for an episode that a newer trigger already replaced', async () => {
    const { tx } = txWith([stored('TRIGGERED', cw('2026-11-08T11:00:00.000Z'))]);
    expect(await check(tx, 'resolve', cw(resolvedAt))).not.toBeNull();
  });

  it('still applies an in-order trigger after a resolve', async () => {
    const { tx } = txWith([stored('RESOLVED', cw(resolvedAt)), stored('TRIGGERED', cw(firedAt))]);
    expect(await check(tx, 'trigger', cw('2026-11-08T11:15:00.000Z'))).toBeNull();
  });

  it('keeps a repeat with the same provider time (not older than the last event)', async () => {
    const { tx } = txWith([stored('TRIGGERED', cw(firedAt))]);
    expect(await check(tx, 'trigger', cw(firedAt))).toBeNull();
  });

  it('accepts the first event for a key', async () => {
    const { tx } = txWith([]);
    expect(await check(tx, 'trigger', cw(firedAt))).toBeNull();
  });

  it('changes nothing for a provider without a time, and does not even query', async () => {
    const { tx, findMany } = txWith([stored('RESOLVED', cw(resolvedAt))]);
    expect(await check(tx, 'trigger', { title: 'x' }, 'DATADOG')).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is not fooled by earlier alerts that carry no time', async () => {
    const { tx } = txWith([stored('TRIGGERED', { note: 'no time' })]);
    expect(await check(tx, 'trigger', cw(firedAt))).toBeNull();
  });
});
