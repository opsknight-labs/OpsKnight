import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';

const state = vi.hoisted(() => ({
  inFlight: 0,
  maxInFlight: 0,
  calls: [] as string[],
  profile: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/privacy/export/domains', () => {
  const tracked = (name: string, value: unknown) => async () => {
    state.calls.push(name);
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    state.inFlight -= 1;
    return value;
  };
  return {
    fetchProfile: async () => {
      state.calls.push('profile');
      return state.profile;
    },
    fetchIdentities: tracked('identities', []),
    fetchMemberships: tracked('memberships', []),
    fetchIncidents: tracked('incidents', []),
    fetchIncidentNotes: tracked('incident-notes', []),
    fetchSchedules: tracked('schedules', { shifts: [], overrides: [] }),
    fetchNotifications: tracked('notifications', { items: [], totalCount: 0, truncated: false }),
    fetchAuditEvents: tracked('audit-events', { items: [], totalCount: 7, truncated: true }),
  };
});

import { generateSubjectExport } from '@/lib/privacy/export/exporter';

const input = { requestId: 'creq00000001', subjectType: 'USER', subjectId: 'cuser0000001' };

describe('generateSubjectExport builds one category at a time', () => {
  beforeEach(() => {
    state.inFlight = 0;
    state.maxInFlight = 0;
    state.calls = [];
    state.profile = {
      id: input.subjectId,
      name: 'Subject',
      email: 'subject@example.com',
      role: 'USER',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
  });

  it('fetches categories sequentially and keeps the manifest first with the final counts', async () => {
    const generated = await generateSubjectExport(input);

    expect(state.maxInFlight).toBe(1);
    expect(state.calls[0]).toBe('profile');
    const zip = await JSZip.loadAsync(generated.buffer);
    expect(Object.keys(zip.files)).toEqual([
      'manifest.json',
      'README.txt',
      'profile.json',
      'identities.json',
      'memberships.json',
      'incidents.json',
      'incident-notes.json',
      'schedules.json',
      'notifications.json',
      'audit-events.json',
    ]);
    const manifest = JSON.parse(await zip.files['manifest.json'].async('text'));
    expect(manifest.completeness).toBe('PARTIAL');
    expect(manifest.domainSummary).toContainEqual(
      expect.objectContaining({ domain: 'audit-events', exportedCount: 0, totalCount: 7 })
    );
    expect(generated.sizeBytes).toBe(generated.buffer.byteLength);
  });

  it('stops after the profile lookup when the subject does not exist', async () => {
    state.profile = null;

    await expect(generateSubjectExport(input)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(state.calls).toEqual(['profile']);
  });
});
