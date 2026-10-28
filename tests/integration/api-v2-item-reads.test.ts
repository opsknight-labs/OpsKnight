import { beforeEach, describe, expect, it } from 'vitest';
import { GET as listTeamMembers } from '@/app/api/v2/teams/[id]/members/route';
import {
  GET as getTeamMember,
  DELETE as removeTeamMember,
} from '@/app/api/v2/teams/[id]/members/[userId]/route';
import { GET as getScheduleLayer } from '@/app/api/v2/schedules/[id]/layers/[layerId]/route';
import {
  GET as getScheduleParticipant,
  DELETE as removeScheduleParticipant,
} from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route';
import { GET as listScheduleOverrides } from '@/app/api/v2/schedules/[id]/overrides/route';
import {
  GET as getScheduleOverride,
  DELETE as cancelScheduleOverride,
} from '@/app/api/v2/schedules/[id]/overrides/[overrideId]/route';
import {
  GET as listPostmortemActionItems,
  PUT as replacePostmortemActionItems,
} from '@/app/api/v2/postmortems/[id]/action-items/route';
import {
  GET as getPostmortemActionItem,
  DELETE as deletePostmortemActionItem,
} from '@/app/api/v2/postmortems/[id]/action-items/[itemId]/route';
import { GET as listIncidentWatchers } from '@/app/api/v2/incidents/[id]/watchers/route';
import {
  GET as getIncidentWatcher,
  DELETE as removeIncidentWatcher,
} from '@/app/api/v2/incidents/[id]/watchers/[watcherId]/route';
import { GET as listStatusPageAssets } from '@/app/api/v2/status-pages/[id]/assets/route';
import {
  GET as getStatusPageAsset,
  DELETE as deleteStatusPageAsset,
} from '@/app/api/v2/status-pages/[id]/assets/[assetId]/route';
import type { NextRouteHandler } from '@/lib/api-v2/endpoint';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const UNKNOWN_CUID = 'cjld2cjxh0000qzrmn831i7rn';
const UNKNOWN_ASSET = 'f'.repeat(64);

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

async function problem(response: Response) {
  return { status: response.status, code: (await response.json()).code as string };
}

describe('getTeamMember', () => {
  async function fixture() {
    const admin = await createV2Credential(['teams:read']);
    const owner = await createV2Credential(['teams:read', 'teams:write'], 'USER');
    const team = await db.team.create({ data: { name: 'Item read team' } });
    await db.teamMember.create({ data: { teamId: team.id, userId: owner.user.id, role: 'OWNER' } });
    const target = await createTestUser();
    await db.teamMember.create({
      data: { teamId: team.id, userId: target.id, role: 'MEMBER', receiveTeamNotifications: false },
    });
    return {
      admin,
      owner,
      team: await db.team.findUniqueOrThrow({ where: { id: team.id } }),
      target,
    };
  }
  const read = (token: string, teamId: string, userId: string) =>
    invokeV2(getTeamMember, token, 'GET', `/teams/${teamId}/members/${userId}`, {
      id: teamId,
      userId,
    });

  it('returns exactly the collection projection plus the team revision and ETag', async () => {
    const { admin, owner, team, target } = await fixture();
    const list = await invokeV2(listTeamMembers, admin.token, 'GET', `/teams/${team.id}/members`, {
      id: team.id,
    });
    const listed = (await list.json()).data.find(
      (member: { userId: string }) => member.userId === target.id
    );
    for (const token of [admin.token, owner.token]) {
      const response = await read(token, team.id, target.id);
      expect(response.status).toBe(200);
      expect(response.headers.get('etag')).toBe(`"${team.revision}"`);
      expect(response.headers.get('etag')).toBe(list.headers.get('etag'));
      expect(response.headers.get('cache-control')).toBe('no-store');
      const data = (await response.json()).data;
      expect(data).toEqual({ ...listed, revision: team.revision });
      expect(Object.keys(data).sort()).toEqual(
        [
          'createdAt',
          'id',
          'receiveTeamNotifications',
          'revision',
          'role',
          'teamId',
          'userId',
        ].sort()
      );
    }
  });

  it('returns 404 for unknown members, unknown teams and members of another team', async () => {
    const { admin, team } = await fixture();
    expect(await problem(await read(admin.token, team.id, UNKNOWN_CUID))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await problem(await read(admin.token, UNKNOWN_CUID, UNKNOWN_CUID))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    const other = await db.team.create({ data: { name: 'Other item read team' } });
    const foreign = await createTestUser();
    await db.teamMember.create({ data: { teamId: other.id, userId: foreign.id } });
    expect(await problem(await read(admin.token, team.id, foreign.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('refuses outsiders and missing scopes exactly like listTeamMembers', async () => {
    const { team, target } = await fixture();
    const outsider = await createV2Credential(['teams:read'], 'USER');
    const unscoped = await createV2Credential(['incidents:read']);
    for (const credential of [outsider, unscoped]) {
      const item = await problem(await read(credential.token, team.id, target.id));
      const list = await problem(
        await invokeV2(listTeamMembers, credential.token, 'GET', `/teams/${team.id}/members`, {
          id: team.id,
        })
      );
      expect(item.status).toBe(403);
      expect(item).toEqual(list);
    }
  });

  it('returns 404 after the membership is removed', async () => {
    const { owner, team, target } = await fixture();
    const before = await read(owner.token, team.id, target.id);
    const removed = await invokeV2(
      removeTeamMember,
      owner.token,
      'DELETE',
      `/teams/${team.id}/members/${target.id}`,
      { id: team.id, userId: target.id },
      undefined,
      { 'If-Match': before.headers.get('etag')!, 'Idempotency-Key': 'item-read-remove-member' }
    );
    expect(removed.status).toBe(200);
    expect(await problem(await read(owner.token, team.id, target.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});

describe('getScheduleParticipant', () => {
  async function fixture() {
    const admin = await createV2Credential(['schedules:read', 'schedules:write']);
    const participant = await createTestUser();
    const second = await createTestUser();
    const schedule = await db.onCallSchedule.create({ data: { name: 'Participant item read' } });
    const layer = await db.onCallLayer.create({
      data: {
        scheduleId: schedule.id,
        name: 'Primary',
        start: new Date('2026-11-01T00:00:00.000Z'),
        users: {
          create: [
            { userId: participant.id, position: 0 },
            { userId: second.id, position: 1 },
          ],
        },
      },
    });
    const otherLayer = await db.onCallLayer.create({
      data: {
        scheduleId: schedule.id,
        name: 'Secondary',
        start: new Date('2026-11-01T00:00:00.000Z'),
        users: { create: [{ userId: admin.user.id, position: 0 }] },
      },
    });
    return {
      admin,
      participant,
      second,
      schedule,
      layer: await db.onCallLayer.findUniqueOrThrow({ where: { id: layer.id } }),
      otherLayer,
    };
  }
  const path = (scheduleId: string, layerId: string, userId: string) =>
    `/schedules/${scheduleId}/layers/${layerId}/participants/${userId}`;
  const read = (token: string, id: string, layerId: string, userId: string) =>
    invokeV2(getScheduleParticipant, token, 'GET', path(id, layerId, userId), {
      id,
      layerId,
      userId,
    });

  it('returns the layer projection of one participant with the layer revision', async () => {
    const { admin, second, schedule, layer } = await fixture();
    const layerRead = await invokeV2(
      getScheduleLayer,
      admin.token,
      'GET',
      `/schedules/${schedule.id}/layers/${layer.id}`,
      { id: schedule.id, layerId: layer.id }
    );
    const listed = (await layerRead.json()).data.users.find(
      (user: { userId: string }) => user.userId === second.id
    );
    const response = await read(admin.token, schedule.id, layer.id, second.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${layer.revision}"`);
    expect(response.headers.get('etag')).toBe(layerRead.headers.get('etag'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).data).toEqual({
      scheduleId: schedule.id,
      layerId: layer.id,
      ...listed,
      revision: layer.revision,
    });
  });

  it('returns 404 for unknown participants, layers and other-layer participants', async () => {
    const { admin, schedule, layer, otherLayer } = await fixture();
    expect(await problem(await read(admin.token, schedule.id, layer.id, UNKNOWN_CUID))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(
      await problem(await read(admin.token, schedule.id, UNKNOWN_CUID, admin.user.id))
    ).toEqual({ status: 404, code: 'SCHEDULE_LAYER_NOT_FOUND' });
    expect(await problem(await read(admin.token, schedule.id, layer.id, admin.user.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    const otherSchedule = await db.onCallSchedule.create({ data: { name: 'Other schedule' } });
    expect(
      await problem(await read(admin.token, otherSchedule.id, otherLayer.id, admin.user.id))
    ).toEqual({ status: 404, code: 'SCHEDULE_LAYER_NOT_FOUND' });
  });

  it('refuses invisible schedules and missing scopes exactly like getScheduleLayer', async () => {
    const { participant, schedule, layer } = await fixture();
    const outsider = await createV2Credential(['schedules:read'], 'USER');
    const unscoped = await createV2Credential(['incidents:read']);
    for (const [credential, status] of [
      [outsider, 404],
      [unscoped, 403],
    ] as const) {
      const item = await problem(
        await read(credential.token, schedule.id, layer.id, participant.id)
      );
      const parent = await problem(
        await invokeV2(
          getScheduleLayer,
          credential.token,
          'GET',
          `/schedules/${schedule.id}/layers/${layer.id}`,
          { id: schedule.id, layerId: layer.id }
        )
      );
      expect(item.status).toBe(status);
      expect(item).toEqual(parent);
    }
  });

  it('returns 404 after the participant is removed', async () => {
    const { admin, participant, schedule, layer } = await fixture();
    const removed = await invokeV2(
      removeScheduleParticipant,
      admin.token,
      'DELETE',
      path(schedule.id, layer.id, participant.id),
      { id: schedule.id, layerId: layer.id, userId: participant.id },
      undefined,
      { 'Idempotency-Key': 'item-read-remove-participant' }
    );
    expect(removed.status).toBe(200);
    expect(await problem(await read(admin.token, schedule.id, layer.id, participant.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});

describe('getScheduleOverride', () => {
  async function fixture() {
    const admin = await createV2Credential(['schedules:read', 'schedules:write']);
    const responder = await createV2Credential(['schedules:read'], 'USER');
    const replaced = await createTestUser();
    const schedule = await db.onCallSchedule.create({ data: { name: 'Override item read' } });
    const override = await db.onCallOverride.create({
      data: {
        scheduleId: schedule.id,
        userId: responder.user.id,
        replacesUserId: replaced.id,
        start: new Date('2026-11-01T00:00:00.000Z'),
        end: new Date('2026-11-01T08:00:00.000Z'),
      },
    });
    return { admin, responder, schedule, override };
  }
  const read = (token: string, id: string, overrideId: string) =>
    invokeV2(getScheduleOverride, token, 'GET', `/schedules/${id}/overrides/${overrideId}`, {
      id,
      overrideId,
    });
  const list = (token: string, id: string) =>
    // The legacy collection handler declares a narrower Next.js context type.
    invokeV2(
      listScheduleOverrides as unknown as NextRouteHandler,
      token,
      'GET',
      `/schedules/${id}/overrides`,
      { id }
    );

  it('returns exactly the collection projection for one override', async () => {
    const { admin, schedule, override } = await fixture();
    const listed = (await (await list(admin.token, schedule.id)).json()).data[0];
    const response = await read(admin.token, schedule.id, override.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = (await response.json()).data;
    expect(data).toEqual(listed);
    expect(Object.keys(data).sort()).toEqual(
      [
        'createdAt',
        'end',
        'endDate',
        'id',
        'replacesUserId',
        'scheduleId',
        'start',
        'startDate',
        'user',
        'userId',
      ].sort()
    );
  });

  it('returns 404 for unknown overrides, unknown schedules and other-schedule overrides', async () => {
    const { admin, schedule, override } = await fixture();
    const notFound = { status: 404, code: 'SCHEDULE_OVERRIDE_NOT_FOUND' };
    expect(await problem(await read(admin.token, schedule.id, UNKNOWN_CUID))).toEqual(notFound);
    expect(await problem(await read(admin.token, UNKNOWN_CUID, override.id))).toEqual(notFound);
    const other = await db.onCallSchedule.create({ data: { name: 'Other override schedule' } });
    expect(await problem(await read(admin.token, other.id, override.id))).toEqual(notFound);
  });

  it('refuses invisible schedules and missing scopes with the collection status', async () => {
    const { responder, schedule, override } = await fixture();
    const outsider = await createV2Credential(['schedules:read'], 'USER');
    const unscoped = await createV2Credential(['incidents:read']);
    for (const [credential, status] of [
      [outsider, 404],
      [unscoped, 403],
    ] as const) {
      const item = await read(credential.token, schedule.id, override.id);
      expect(item.status).toBe(status);
      expect((await list(credential.token, schedule.id)).status).toBe(status);
    }
    // A scoped USER sees the schedule through its own override, as in the collection.
    expect((await read(responder.token, schedule.id, override.id)).status).toBe(200);
    expect((await list(responder.token, schedule.id)).status).toBe(200);
  });

  it('returns 404 after the override is cancelled', async () => {
    const { admin, schedule, override } = await fixture();
    const cancelled = await invokeV2(
      cancelScheduleOverride,
      admin.token,
      'DELETE',
      `/schedules/${schedule.id}/overrides/${override.id}`,
      { id: schedule.id, overrideId: override.id },
      undefined,
      { 'Idempotency-Key': 'item-read-cancel-override' }
    );
    expect(cancelled.status).toBe(200);
    expect(await problem(await read(admin.token, schedule.id, override.id))).toEqual({
      status: 404,
      code: 'SCHEDULE_OVERRIDE_NOT_FOUND',
    });
  });
});

describe('getPostmortemActionItem', () => {
  const scopes = ['postmortems:read', 'postmortems:write', 'incidents:read'];
  async function postmortemWithItems(
    token: string,
    title: string,
    visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC'
  ) {
    const service = await createTestService(title);
    const incident = await createTestIncident(title, service.id, {
      status: 'RESOLVED',
      visibility,
    });
    const parent = await db.postmortem.create({
      data: { incidentId: incident.id, title, summary: `${title} summary` },
    });
    const path = `/postmortems/${parent.id}/action-items`;
    const initial = await invokeV2(listPostmortemActionItems, token, 'GET', path, {
      id: parent.id,
    });
    const replaced = await invokeV2(
      replacePostmortemActionItems,
      token,
      'PUT',
      path,
      { id: parent.id },
      {
        items: [
          {
            title: 'Add a regression test',
            description: 'Cover the failure mode',
            ownerId: null,
            dueDate: '2026-11-02',
            status: 'OPEN',
            priority: 'HIGH',
          },
          { title: 'Document recovery', status: 'IN_PROGRESS', priority: 'LOW' },
        ],
      },
      { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': `items-${parent.id}` }
    );
    expect(replaced.status).toBe(200);
    return { incident, parent, collection: (await replaced.json()).data };
  }
  const read = (token: string, id: string, itemId: string) =>
    invokeV2(getPostmortemActionItem, token, 'GET', `/postmortems/${id}/action-items/${itemId}`, {
      id,
      itemId,
    });

  it('returns one collection item with the postmortem revision by postmortem or incident ID', async () => {
    const writer = await createV2Credential(scopes);
    const reader = await createV2Credential(['postmortems:read', 'incidents:read']);
    const { incident, parent, collection } = await postmortemWithItems(writer.token, 'Item read');
    const listed = await invokeV2(
      listPostmortemActionItems,
      reader.token,
      'GET',
      `/postmortems/${parent.id}/action-items`,
      { id: parent.id }
    );
    const listedData = (await listed.json()).data;
    for (const id of [parent.id, incident.id]) {
      for (const item of listedData.items) {
        const response = await read(reader.token, id, item.id);
        expect(response.status).toBe(200);
        expect(response.headers.get('etag')).toBe(`"${collection.revision}"`);
        expect(response.headers.get('etag')).toBe(listed.headers.get('etag'));
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect((await response.json()).data).toEqual({
          ...item,
          postmortemId: parent.id,
          revision: collection.revision,
        });
      }
    }
  });

  it('returns 404 for unknown items, unknown postmortems and items of another postmortem', async () => {
    const writer = await createV2Credential(scopes);
    const { parent, collection } = await postmortemWithItems(writer.token, 'First');
    const { collection: other } = await postmortemWithItems(writer.token, 'Second');
    expect(await problem(await read(writer.token, parent.id, 'missing-item'))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(
      await problem(await read(writer.token, 'missing-parent', collection.items[0].id))
    ).toEqual({ status: 404, code: 'POSTMORTEM_NOT_FOUND' });
    expect(await problem(await read(writer.token, parent.id, other.items[0].id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('refuses private parents and missing scopes exactly like listPostmortemActionItems', async () => {
    const writer = await createV2Credential(scopes);
    const { parent, collection } = await postmortemWithItems(writer.token, 'Private', 'PRIVATE');
    const outsider = await createV2Credential(['postmortems:read', 'incidents:read'], 'USER');
    const unscoped = await createV2Credential(['incidents:read']);
    for (const [credential, status] of [
      [outsider, 404],
      [unscoped, 403],
    ] as const) {
      const item = await problem(await read(credential.token, parent.id, collection.items[0].id));
      const list = await problem(
        await invokeV2(
          listPostmortemActionItems,
          credential.token,
          'GET',
          `/postmortems/${parent.id}/action-items`,
          { id: parent.id }
        )
      );
      expect(item.status).toBe(status);
      expect(item).toEqual(list);
    }
  });

  it('returns 404 after the item is deleted', async () => {
    const writer = await createV2Credential(scopes);
    const { parent, collection } = await postmortemWithItems(writer.token, 'Deletion');
    const itemId = collection.items[0].id;
    const deleted = await invokeV2(
      deletePostmortemActionItem,
      writer.token,
      'DELETE',
      `/postmortems/${parent.id}/action-items/${itemId}`,
      { id: parent.id, itemId },
      undefined,
      { 'If-Match': `"${collection.revision}"`, 'Idempotency-Key': 'item-read-delete-action' }
    );
    expect(deleted.status).toBe(200);
    expect(await problem(await read(writer.token, parent.id, itemId))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect((await read(writer.token, parent.id, collection.items[1].id)).status).toBe(200);
  });
});

describe('getIncidentWatcher', () => {
  async function fixture() {
    const admin = await createV2Credential(['incidents:read', 'incidents:write']);
    const service = await createTestService('Watcher item read');
    const incident = await createTestIncident('Private watched incident', service.id, {
      visibility: 'PRIVATE',
    });
    const watcherUser = await createTestUser();
    const watcher = await db.incidentWatcher.create({
      data: { incidentId: incident.id, userId: watcherUser.id, role: 'STAKEHOLDER' },
    });
    return { admin, service, incident, watcher };
  }
  const read = (token: string, id: string, watcherId: string) =>
    invokeV2(getIncidentWatcher, token, 'GET', `/incidents/${id}/watchers/${watcherId}`, {
      id,
      watcherId,
    });
  const list = (token: string, id: string) =>
    invokeV2(listIncidentWatchers, token, 'GET', `/incidents/${id}/watchers`, { id });

  it('returns exactly the collection projection for one watcher', async () => {
    const { admin, incident, watcher } = await fixture();
    const listed = (await (await list(admin.token, incident.id)).json()).data[0];
    const response = await read(admin.token, incident.id, watcher.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = (await response.json()).data;
    expect(data).toEqual(listed);
    expect(Object.keys(data).sort()).toEqual(
      ['createdAt', 'id', 'incidentId', 'role', 'userId'].sort()
    );
  });

  it('returns 404 for unknown watchers, unknown incidents and watchers of another incident', async () => {
    const { admin, service, incident, watcher } = await fixture();
    expect(await problem(await read(admin.token, incident.id, 'missing-watcher'))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await problem(await read(admin.token, 'missing-incident', watcher.id))).toEqual({
      status: 404,
      code: 'INCIDENT_NOT_FOUND',
    });
    const other = await createTestIncident('Other incident', service.id);
    expect(await problem(await read(admin.token, other.id, watcher.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('refuses invisible incidents and missing scopes exactly like listIncidentWatchers', async () => {
    const { incident, watcher } = await fixture();
    const outsider = await createV2Credential(['incidents:read'], 'USER');
    const unscoped = await createV2Credential(['schedules:read']);
    for (const [credential, status] of [
      [outsider, 404],
      [unscoped, 403],
    ] as const) {
      const item = await problem(await read(credential.token, incident.id, watcher.id));
      const collection = await problem(await list(credential.token, incident.id));
      expect(item.status).toBe(status);
      expect(item).toEqual(collection);
    }
  });

  it('returns 404 after the watcher is removed', async () => {
    const { admin, incident, watcher } = await fixture();
    const removed = await invokeV2(
      removeIncidentWatcher,
      admin.token,
      'DELETE',
      `/incidents/${incident.id}/watchers/${watcher.id}`,
      { id: incident.id, watcherId: watcher.id },
      undefined,
      { 'Idempotency-Key': 'item-read-remove-watcher' }
    );
    expect(removed.status).toBe(200);
    expect(await problem(await read(admin.token, incident.id, watcher.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});

describe('getStatusPageAsset', () => {
  async function fixture() {
    const writer = await createV2Credential(['status-pages:read', 'status-pages:write']);
    const reader = await createV2Credential(['status-pages:read']);
    const page = await db.statusPage.create({ data: { name: 'Asset item', slug: 'asset-item' } });
    const asset = await db.statusPageAsset.create({
      data: {
        id: 'a'.repeat(64),
        statusPageId: page.id,
        contentType: 'image/png',
        data: Buffer.from('not-returned-image-bytes'),
      },
    });
    return { writer, reader, page, asset };
  }
  const read = (token: string, id: string, assetId: string) =>
    invokeV2(getStatusPageAsset, token, 'GET', `/status-pages/${id}/assets/${assetId}`, {
      id,
      assetId,
    });
  const list = (token: string, id: string) =>
    invokeV2(listStatusPageAssets, token, 'GET', `/status-pages/${id}/assets`, { id });

  it('returns asset metadata exactly as listed and never image bytes', async () => {
    const { reader, page, asset } = await fixture();
    const listed = (await (await list(reader.token, page.id)).json()).data;
    const response = await read(reader.token, page.id, asset.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const text = await response.text();
    expect(text).not.toContain(Buffer.from('not-returned-image-bytes').toString('base64'));
    expect(text).not.toContain('not-returned-image-bytes');
    expect(JSON.parse(text).data).toEqual({
      statusPageId: listed.statusPageId,
      ...listed.assets[0],
    });
    expect(Object.keys(JSON.parse(text).data).sort()).toEqual(
      ['assetId', 'contentType', 'createdAt', 'statusPageId', 'url'].sort()
    );
  });

  it('returns 404 for unknown assets, unknown pages and assets of another page', async () => {
    const { reader, page, asset } = await fixture();
    expect(await problem(await read(reader.token, page.id, UNKNOWN_ASSET))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(await problem(await read(reader.token, UNKNOWN_CUID, asset.id))).toEqual({
      status: 404,
      code: 'STATUS_PAGE_NOT_FOUND',
    });
    const other = await db.statusPage.create({ data: { name: 'Other page', slug: 'other-page' } });
    expect(await problem(await read(reader.token, other.id, asset.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('refuses unauthorized roles and missing scopes exactly like listStatusPageAssets', async () => {
    const { page, asset } = await fixture();
    const user = await createV2Credential(['status-pages:read'], 'USER');
    const unscoped = await createV2Credential(['incidents:read']);
    const item = await problem(await read(unscoped.token, page.id, asset.id));
    expect(item.status).toBe(403);
    expect(item).toEqual(await problem(await list(unscoped.token, page.id)));
    const userItem = await read(user.token, page.id, asset.id);
    const userList = await list(user.token, page.id);
    expect(userItem.status).toBe(userList.status);
    if (userItem.status !== 200) expect(await problem(userItem)).toEqual(await problem(userList));
  });

  it('returns 404 after the asset is deleted', async () => {
    const { writer, page, asset } = await fixture();
    const deleted = await invokeV2(
      deleteStatusPageAsset,
      writer.token,
      'DELETE',
      `/status-pages/${page.id}/assets/${asset.id}`,
      { id: page.id, assetId: asset.id },
      undefined,
      { 'Idempotency-Key': 'item-read-delete-asset' }
    );
    expect(deleted.status).toBe(204);
    expect(await problem(await read(writer.token, page.id, asset.id))).toEqual({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});
