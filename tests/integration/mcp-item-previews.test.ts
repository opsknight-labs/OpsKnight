import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { GET as getTeamMember } from '@/app/api/v2/teams/[id]/members/[userId]/route';
import { GET as getScheduleParticipant } from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route';
import { GET as getScheduleOverride } from '@/app/api/v2/schedules/[id]/overrides/[overrideId]/route';
import { GET as getPostmortemActionItem } from '@/app/api/v2/postmortems/[id]/action-items/[itemId]/route';
import type { NextRouteHandler } from '@/lib/api-v2/endpoint';
import { MCP_OPERATION_MAP } from '@/lib/mcp/catalog';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { executeMcpPlan, planSchema } from '@/lib/mcp/core/plan';
import { projectMcpData } from '@/lib/mcp/core/projection';
import {
  actionItemInputSchema,
  replacePostmortemActionItems,
} from '@/lib/postmortems/action-item-commands';
import { invokeV2 } from '../helpers/api-v2';
import {
  describeSensitiveReads,
  principal,
  setupMcpReadDatabase,
} from '../helpers/mcp-read-scenarios';
import {
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestStatusPage,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';

// One setup for both blocks: it enables the sensitive-reads opt-in, which R0 reads ignore.
setupMcpReadDatabase();

const UNKNOWN_CUID = 'cjld2cjxh0000qzrmn831i7rn';

describeSensitiveReads([
  {
    name: 'incident watcher',
    operationId: 'getIncidentWatcher',
    setup: async () => {
      const service = await createTestService('Watcher preview read');
      // Private, so a caller who cannot see the incident is refused by REST.
      const incident = await createTestIncident('Private watched incident', service.id, {
        visibility: 'PRIVATE',
      });
      const watcher = await db.incidentWatcher.create({
        data: { incidentId: incident.id, userId: (await createTestUser()).id, role: 'STAKEHOLDER' },
      });
      return { path: { id: incident.id, watcherId: watcher.id } };
    },
  },
  {
    name: 'status page asset',
    operationId: 'getStatusPageAsset',
    setup: async () => {
      const page = await createTestStatusPage();
      const asset = await db.statusPageAsset.create({
        data: {
          id: randomBytes(32).toString('hex'),
          statusPageId: page.id,
          contentType: 'image/png',
          data: Buffer.from('never-returned-image-bytes'),
        },
      });
      return { path: { id: page.id, assetId: asset.id } };
    },
  },
]);

type Path = Record<string, string>;
interface ItemRead {
  name: string;
  operationId: string;
  route: NextRouteHandler;
  /** Scopes the native route needs beyond the catalog's own (it also authorizes the parent). */
  parentScopes?: string[];
  /** Creates one item under a parent that ordinary outsiders cannot see. */
  setup(owner: { id: string }): Promise<Path>;
  /** The same parent with an item identifier that does not exist. */
  unknown(path: Path): Path;
}

const itemReads: ItemRead[] = [
  {
    name: 'team member',
    operationId: 'getTeamMember',
    route: getTeamMember,
    setup: async () => {
      const team = await createTestTeam('Member preview read');
      const member = await createTestUser();
      await db.teamMember.create({
        data: { teamId: team.id, userId: member.id, role: 'MEMBER' },
      });
      return { id: team.id, userId: member.id };
    },
    unknown: path => ({ ...path, userId: UNKNOWN_CUID }),
  },
  {
    name: 'schedule participant',
    operationId: 'getScheduleParticipant',
    route: getScheduleParticipant,
    setup: async () => {
      const first = await createTestUser();
      const second = await createTestUser();
      const schedule = await createTestOnCallSchedule('Participant preview read', [
        { name: 'Primary', userIds: [first.id, second.id] },
      ]);
      return { id: schedule.id, layerId: schedule.layers[0].id, userId: second.id };
    },
    unknown: path => ({ ...path, userId: UNKNOWN_CUID }),
  },
  {
    name: 'schedule override',
    operationId: 'getScheduleOverride',
    route: getScheduleOverride,
    setup: async () => {
      const covering = await createTestUser();
      const replaced = await createTestUser();
      const schedule = await createTestOnCallSchedule('Override preview read');
      const override = await db.onCallOverride.create({
        data: {
          scheduleId: schedule.id,
          userId: covering.id,
          replacesUserId: replaced.id,
          start: new Date('2026-11-01T00:00:00.000Z'),
          end: new Date('2026-11-01T08:00:00.000Z'),
        },
      });
      return { id: schedule.id, overrideId: override.id };
    },
    unknown: path => ({ ...path, overrideId: UNKNOWN_CUID }),
  },
  {
    name: 'postmortem action item',
    operationId: 'getPostmortemActionItem',
    route: getPostmortemActionItem,
    // A postmortem is read through its incident, so REST also requires incidents:read.
    parentScopes: ['incidents:read'],
    setup: async owner => {
      const service = await createTestService('Action item preview read');
      const incident = await createTestIncident('Restricted postmortem incident', service.id, {
        status: 'RESOLVED',
        visibility: 'PRIVATE',
      });
      const postmortem = await db.postmortem.create({
        data: { incidentId: incident.id, title: 'Restricted postmortem', createdById: owner.id },
      });
      const collection = await db.$transaction(tx =>
        replacePostmortemActionItems(tx, postmortem.id, postmortem.revision, [
          actionItemInputSchema.parse({
            title: 'Add a regression test',
            description: 'Cover the failure mode',
            priority: 'HIGH',
          }),
          actionItemInputSchema.parse({ title: 'Document recovery', status: 'IN_PROGRESS' }),
        ])
      );
      return { id: postmortem.id, itemId: collection.items[1].id };
    },
    unknown: path => ({ ...path, itemId: 'missing-item' }),
  },
];

const operationPath = (operationId: string, path: Path) => {
  const values = new Map(Object.entries(path));
  return MCP_OPERATION_MAP.get(operationId)!.path.replace(/\{(\w+)\}/g, (_, key: string) =>
    encodeURIComponent(values.get(key) ?? '')
  );
};
const rest = (read: ItemRead, token: string, path: Path) =>
  invokeV2(read.route, token, 'GET', operationPath(read.operationId, path), path);
const scopesOf = (read: ItemRead) => [
  ...MCP_OPERATION_MAP.get(read.operationId)!.requiredScopes,
  ...(read.parentScopes ?? []),
];

describe.each(itemReads)('item preview read $name ($operationId)', (read: ItemRead) => {
  it('is a discoverable R0 read', () => {
    expect(MCP_OPERATION_MAP.get(read.operationId)).toMatchObject({
      status: 'DISCOVERABLE',
      risk: 'R0',
      method: 'get',
    });
  });

  it('returns exactly what REST returns to an authorized administrator', async () => {
    const admin = await principal('ADMIN', scopesOf(read));
    const path = await read.setup(admin.user);
    const response = await rest(read, admin.restToken, path);
    expect(response.status).toBe(200);
    const restBody = await response.json();
    const result = await callMcpOperation(admin.ctx(), read.operationId, { path });
    // The same item, with MCP's standard redaction applied to the REST representation.
    const data = (result.data as { data: unknown }).data;
    expect(data).toEqual(projectMcpData(restBody.data));
    expect(JSON.stringify(data)).toContain(Object.values(path).at(-1)!);
    expect(result.evidence).toMatchObject({
      operationId: read.operationId,
      etag: response.headers.get('etag'),
    });
  });

  it('is refused by MCP whenever REST refuses a caller who cannot see the parent', async () => {
    const owner = await createTestUser({ role: 'ADMIN' });
    const path = await read.setup(owner);
    const refusedByRest: string[] = [];
    for (const role of ['USER', 'RESPONDER', 'AUDITOR'] as const) {
      const caller = await principal(role, scopesOf(read));
      const status = (await rest(read, caller.restToken, path)).status;
      const mcp = await callMcpOperation(caller.ctx(), read.operationId, { path }).then(
        () => 'allowed' as const,
        () => 'refused' as const
      );
      if (status >= 400) {
        refusedByRest.push(role);
        expect(mcp, `${role}: REST ${status}`).toBe('refused');
      }
    }
    // The fixture's parent really is restricted for ordinary users.
    expect(refusedByRest).toContain('USER');
  });

  it('refuses an unknown item identifier', async () => {
    const admin = await principal('ADMIN', scopesOf(read));
    const path = read.unknown(await read.setup(admin.user));
    expect((await rest(read, admin.restToken, path)).status).toBe(404);
    await expect(callMcpOperation(admin.ctx(), read.operationId, { path })).rejects.toThrow(
      'MCP_RESOURCE_UNAVAILABLE'
    );
  });

  it('is allowed in a declarative read plan', async () => {
    const admin = await principal('ADMIN', scopesOf(read));
    const path = await read.setup(admin.user);
    const direct = await callMcpOperation(admin.ctx(), read.operationId, { path });
    const plan = await executeMcpPlan(
      admin.ctx(),
      planSchema.parse({ steps: [{ id: 'a', operationId: read.operationId, args: { path } }] })
    );
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ id: 'a', status: 'completed' });
    const planned = plan.steps[0].result as { data: { data: unknown } };
    expect(planned.data.data).toEqual((direct.data as { data: unknown }).data);
  });
});
