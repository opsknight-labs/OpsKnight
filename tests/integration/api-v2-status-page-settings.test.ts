import { beforeEach, expect, it } from 'vitest';
import { createV2Credential, invokeV2 as invokeRawV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase, createTestService } from '../helpers/test-db';
import {
  GET as appearance,
  PATCH as changeAppearance,
} from '@/app/api/v2/status-pages/[id]/appearance/route';
import {
  GET as privacy,
  PATCH as changePrivacy,
} from '@/app/api/v2/status-pages/[id]/privacy/route';
import {
  GET as content,
  PATCH as changeContent,
} from '@/app/api/v2/status-pages/[id]/content/route';
import {
  GET as settings,
  PATCH as changeSettings,
} from '@/app/api/v2/status-pages/[id]/settings/route';
import { saveStatusPageSection } from '@/lib/status-pages/settings-command';
import { getStatusPageServingStore } from '@/lib/status-pages/serving-store';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';

function invokeV2(...args: Parameters<typeof invokeRawV2>) {
  if (args[2] !== 'GET') args[6] = { 'Idempotency-Key': crypto.randomUUID(), ...args[6] };
  return invokeRawV2(...args);
}
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});
async function fixture() {
  const credential = await createV2Credential(['status-pages:read', 'status-pages:write']);
  const page = await db.statusPage.create({
    data: {
      name: 'Configuration fixture',
      slug: `configuration-${crypto.randomUUID()}`,
      enabled: true,
      showSubscribe: true,
    },
  });
  await publishStatusPageSnapshot(page.id);
  return { credential, page, params: { id: page.id }, path: `/status-pages/${page.id}` };
}
it('reads bounded sections with a common strong configuration validator and rejects mixed-section writes', async () => {
  const f = await fixture();
  for (const [handler, section] of [
    [appearance, 'appearance'],
    [privacy, 'privacy'],
    [content, 'content'],
    [settings, 'settings'],
  ] as const) {
    const response = await invokeV2(
      handler,
      f.credential.token,
      'GET',
      `${f.path}/${section}`,
      f.params
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${f.page.revision}"`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const data = (await response.json()).data;
    expect(data).toMatchObject({ id: f.page.id, revision: f.page.revision });
    expect(data.values).not.toHaveProperty('customDomain');
  }
  expect(
    (
      await invokeV2(
        changeAppearance,
        f.credential.token,
        'PATCH',
        `${f.path}/appearance`,
        f.params,
        { enabled: false },
        { 'If-Match': `"${f.page.revision}"` }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        changeSettings,
        f.credential.token,
        'PATCH',
        `${f.path}/settings`,
        f.params,
        { customDomain: 'unverified.example.com' },
        { 'If-Match': `"${f.page.revision}"` }
      )
    ).status
  ).toBe(400);
});
it('writes content/settings/branding through canonical publication with exact API-attributed audit', async () => {
  const f = await fixture();
  let revision = f.page.revision;
  for (const [handler, section, body] of [
    [changeContent, 'content', { footerText: 'Reviewed REST footer' }],
    [changeSettings, 'settings', { organizationName: 'Reviewed organization' }],
    [changeAppearance, 'appearance', { branding: { primaryColor: '#123456' } }],
  ] as const) {
    const response = await invokeV2(
      handler,
      f.credential.token,
      'PATCH',
      `${f.path}/${section}`,
      f.params,
      body,
      { 'If-Match': `"${revision}"` }
    );
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.revision).toBeGreaterThan(revision);
    expect(response.headers.get('etag')).toBe(`"${data.revision}"`);
    expect(['LIVE', 'PUBLISHING']).toContain(data.publication.status);
    revision = data.revision;
  }
  const audits = await db.auditLog.findMany({
    where: { action: 'status_page.config.updated', entityId: f.page.id },
  });
  expect(audits).toHaveLength(3);
  for (const event of audits)
    expect(event.details).toMatchObject({
      source: 'API',
      metadata: { apiClientId: f.credential.key.id },
    });
});
it('requires concrete preconditions and serializes concurrent writers without accepting stale/no-op reviews', async () => {
  const f = await fixture();
  const call = (body: unknown, tag?: string) =>
    invokeV2(
      changeContent,
      f.credential.token,
      'PATCH',
      `${f.path}/content`,
      f.params,
      body,
      tag ? { 'If-Match': tag } : {}
    );
  expect((await call({ footerText: 'x' })).status).toBe(428);
  expect((await call({ footerText: 'x' }, '*')).status).toBe(400);
  const results = await Promise.all([
    call({ footerText: 'A' }, `"${f.page.revision}"`),
    call({ footerText: 'B' }, `"${f.page.revision}"`),
  ]);
  expect(results.map(r => r.status).sort()).toEqual([200, 412]);
  const saved = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  expect((await call({ footerText: saved.footerText }, `"${f.page.revision}"`)).status).toBe(412);
  expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(1);
});
it('fences legacy parent and nested service presentation writes', async () => {
  const f = await fixture();
  const service = await createTestService('Public component');
  const mapping = await db.statusPageService.create({
    data: { statusPageId: f.page.id, serviceId: service.id },
  });
  const mapped = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  expect(mapped.revision).toBeGreaterThan(f.page.revision);
  await db.statusPageService.update({
    where: { id: mapping.id },
    data: { displayName: 'Changed by UI' },
  });
  const changed = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  expect(changed.revision).toBeGreaterThan(mapped.revision);
  expect(
    (
      await invokeV2(
        changePrivacy,
        f.credential.token,
        'PATCH',
        `${f.path}/privacy`,
        f.params,
        { showIncidentTitles: false },
        { 'If-Match': `"${mapped.revision}"` }
      )
    ).status
  ).toBe(412);
});
it('uses the canonical fail-closed publication privacy policy when disclosure narrows', async () => {
  const f = await fixture();
  const service = await createTestService('Public service privacy');
  await db.statusPageService.create({ data: { statusPageId: f.page.id, serviceId: service.id } });
  await db.incident.create({
    data: { serviceId: service.id, title: 'private incident title', status: 'OPEN' },
  });
  await publishStatusPageSnapshot(f.page.id);
  const before = await getStatusPageServingStore().readLastGoodSnapshot(f.page.id);
  expect(JSON.stringify(before)).toContain('private incident title');
  const current = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  const response = await invokeV2(
    changePrivacy,
    f.credential.token,
    'PATCH',
    `${f.path}/privacy`,
    f.params,
    { showIncidentTitles: false },
    { 'If-Match': `"${current.revision}"` }
  );
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.classification.failClosed).toBe(true);
  expect(
    (await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } })).showIncidentTitles
  ).toBe(false);
  const stored = await getStatusPageServingStore().readLastGoodSnapshot(f.page.id);
  expect(stored).not.toBeNull();
  expect(JSON.stringify(stored)).not.toContain('private incident title');
});
it.each(['RESPONDER', 'AUDITOR', 'USER'] as const)(
  'denies configuration writes to %s with write scope',
  async role => {
    const f = await fixture();
    const actor = await createV2Credential(['status-pages:write'], role);
    expect(
      (
        await invokeV2(
          changeContent,
          actor.token,
          'PATCH',
          `${f.path}/content`,
          f.params,
          { footerText: 'unauthorized' },
          { 'If-Match': `"${f.page.revision}"` }
        )
      ).status
    ).toBe(403);
  }
);
it('rejects cross-field invalid thresholds and leaves the shared revision unchanged', async () => {
  const f = await fixture();
  await expect(
    saveStatusPageSection(
      f.page.id,
      { uptimeExcellentThreshold: 50, uptimeGoodThreshold: 99 },
      { id: f.credential.user.id },
      f.page.revision,
      'content'
    )
  ).rejects.toThrow();
  expect((await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } })).revision).toBe(
    f.page.revision
  );
});

it('replaces service membership, preserves nested ownership and fences presentation edits with the resulting revision', async () => {
  const { GET: listServices, PUT: setServices } =
    await import('@/app/api/v2/status-pages/[id]/services/route');
  const { PATCH: updateService } =
    await import('@/app/api/v2/status-pages/[id]/services/[serviceId]/route');
  const f = await fixture();
  const service = await createTestService('REST status component');
  const selected = await invokeV2(
    setServices,
    f.credential.token,
    'PUT',
    `${f.path}/services`,
    f.params,
    {
      serviceIds: [service.id],
      serviceConfigs: {
        [service.id]: { displayName: 'Public service', showOnPage: true, order: 3 },
      },
    },
    { 'If-Match': `"${f.page.revision}"` }
  );
  expect(selected.status).toBe(200);
  const first = (await selected.json()).data;
  const actual = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  expect(first.revision).toBe(actual.revision);
  const listed = await invokeV2(
    listServices,
    f.credential.token,
    'GET',
    `${f.path}/services?limit=1`,
    f.params
  );
  expect((await listed.json()).data).toEqual([
    expect.objectContaining({ serviceId: service.id, displayName: 'Public service' }),
  ]);
  const changed = await invokeV2(
    updateService,
    f.credential.token,
    'PATCH',
    `${f.path}/services/${service.id}`,
    { ...f.params, serviceId: service.id },
    { displayName: 'Reviewed display', showOnPage: false },
    { 'If-Match': `"${first.revision}"` }
  );
  expect(changed.status).toBe(200);
  const next = (await changed.json()).data;
  expect(next.revision).toBeGreaterThan(first.revision);
  expect(
    (await db.statusPageService.findFirstOrThrow({ where: { statusPageId: f.page.id } })).showOnPage
  ).toBe(false);
  const notSelected = await createTestService('Not selected');
  expect(
    (
      await invokeV2(
        updateService,
        f.credential.token,
        'PATCH',
        `${f.path}/services/${notSelected.id}`,
        { ...f.params, serviceId: notSelected.id },
        { displayName: 'cross-parent' },
        { 'If-Match': `"${next.revision}"` }
      )
    ).status
  ).toBe(404);
  expect(
    (
      await invokeV2(
        setServices,
        f.credential.token,
        'PUT',
        `${f.path}/services`,
        f.params,
        { serviceIds: [service.id, service.id] },
        { 'If-Match': `"${next.revision}"` }
      )
    ).status
  ).toBe(400);
});
it('rejects inline branding uploads before writes and returns no API revision change', async () => {
  const f = await fixture();
  const response = await invokeV2(
    changeAppearance,
    f.credential.token,
    'PATCH',
    `${f.path}/appearance`,
    f.params,
    { branding: { logoUrl: 'data:image/png;base64,bm90YW5pbWFnZQ==' } },
    { 'If-Match': `"${f.page.revision}"` }
  );
  expect(response.status).toBe(400);
  expect((await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } })).revision).toBe(
    f.page.revision
  );
});

it('rolls back configuration, revision and audit on a persistence failure, then safely retries the same reviewed revision', async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_status_config_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'status_page.config.updated' THEN RAISE EXCEPTION 'Config audit unavailable'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_status_config_audit_failure_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_status_config_audit_failure()`
  );
  const call = () =>
    invokeV2(
      changePrivacy,
      f.credential.token,
      'PATCH',
      `${f.path}/privacy`,
      f.params,
      { showIncidentTitles: false },
      { 'If-Match': `"${f.page.revision}"`, 'Idempotency-Key': 'status-config-audit-recovery' }
    );
  try {
    expect((await call()).status).toBe(500);
    expect(await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } })).toMatchObject({
      revision: f.page.revision,
      showIncidentTitles: true,
    });
    expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER test_status_config_audit_failure_trigger ON "AuditLog"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION test_status_config_audit_failure()');
  }
  expect((await call()).status).toBe(200);
  expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(1);
});

it('requires durable keys, replays committed metadata after later edits and rejects conflicting payloads', async () => {
  const f = await fixture();
  const path = `${f.path}/content`;
  expect(
    (
      await invokeRawV2(
        changeContent,
        f.credential.token,
        'PATCH',
        path,
        f.params,
        { footerText: 'required key' },
        { 'If-Match': `"${f.page.revision}"` }
      )
    ).status
  ).toBe(400);
  const headers = { 'If-Match': `"${f.page.revision}"`, 'Idempotency-Key': 'content-replay' };
  const call = () =>
    invokeV2(
      changeContent,
      f.credential.token,
      'PATCH',
      path,
      f.params,
      { footerText: 'first committed change' },
      headers
    );
  const first = await call();
  expect(first.status).toBe(200);
  const initial = (await first.json()).data;
  const later = await invokeV2(
    changeContent,
    f.credential.token,
    'PATCH',
    path,
    f.params,
    { footerText: 'later reviewed change' },
    { 'If-Match': `"${initial.revision}"` }
  );
  expect(later.status).toBe(200);
  const replay = await call();
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data.revision).toBe(initial.revision);
  expect((await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } })).footerText).toBe(
    'later reviewed change'
  );
  expect(
    (
      await invokeV2(
        changeContent,
        f.credential.token,
        'PATCH',
        path,
        f.params,
        { footerText: 'conflicting payload' },
        headers
      )
    ).status
  ).toBe(409);
  expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(2);
  await db.user.update({ where: { id: f.credential.user.id }, data: { role: 'AUDITOR' } });
  expect((await call()).status).toBe(403);
});

it('serializes simultaneous identical keys and naturally unchanged configuration without duplicate audit', async () => {
  const f = await fixture();
  const headers = { 'If-Match': `"${f.page.revision}"`, 'Idempotency-Key': 'concurrent-config' };
  const calls = await Promise.all(
    [0, 1].map(() =>
      invokeV2(
        changePrivacy,
        f.credential.token,
        'PATCH',
        `${f.path}/privacy`,
        f.params,
        { showIncidentTitles: false },
        headers
      )
    )
  );
  expect(calls.map(r => r.status)).toEqual([200, 200]);
  expect(await getStatusPageServingStore().readLastGoodSnapshot(f.page.id)).not.toBeNull();
  expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(1);
  const current = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  const noOpHeaders = {
    'If-Match': `"${current.revision}"`,
    'Idempotency-Key': 'unchanged-config',
  };
  for (let index = 0; index < 2; index++)
    expect(
      (
        await invokeV2(
          changePrivacy,
          f.credential.token,
          'PATCH',
          `${f.path}/privacy`,
          f.params,
          { showIncidentTitles: false },
          noOpHeaders
        )
      ).status
    ).toBe(200);
  expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(1);
});

it('updates one component in place and preserves mapping cursor boundaries and unchanged revisions', async () => {
  const { GET: listServices } = await import('@/app/api/v2/status-pages/[id]/services/route');
  const { PATCH: updateService } =
    await import('@/app/api/v2/status-pages/[id]/services/[serviceId]/route');
  const f = await fixture();
  const services = await Promise.all(
    Array.from({ length: 4 }, (_, i) => createTestService(`Stable component ${i}`))
  );
  const mappings = await Promise.all(
    services.map((service, i) =>
      db.statusPageService.create({
        data: {
          statusPageId: f.page.id,
          serviceId: service.id,
          createdAt: new Date(Date.UTC(2025, 0, i + 1)),
          order: i,
        },
      })
    )
  );
  const before = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  const first = await invokeV2(
    listServices,
    f.credential.token,
    'GET',
    `${f.path}/services?limit=2`,
    f.params
  );
  const firstPage = await first.json();
  expect(firstPage.data.map((row: { id: string }) => row.id)).toEqual([
    mappings[3].id,
    mappings[2].id,
  ]);
  const changed = await invokeV2(
    updateService,
    f.credential.token,
    'PATCH',
    `${f.path}/services/${services[3].id}`,
    { ...f.params, serviceId: services[3].id },
    { displayName: 'Changed in place' },
    { 'If-Match': `"${before.revision}"` }
  );
  expect(changed.status).toBe(200);
  expect((await changed.json()).data.revision).toBe(before.revision + 2);
  for (const mapping of mappings) {
    const saved = await db.statusPageService.findUniqueOrThrow({ where: { id: mapping.id } });
    expect(saved.createdAt).toEqual(mapping.createdAt);
    expect(saved.displayName).toBe(
      mapping.serviceId === services[3].id ? 'Changed in place' : null
    );
  }
  const next = await invokeV2(
    listServices,
    f.credential.token,
    'GET',
    `${f.path}/services?limit=2&cursor=${encodeURIComponent(firstPage.pagination.nextCursor)}`,
    f.params
  );
  expect(next.status).toBe(200);
  expect((await next.json()).data.map((row: { id: string }) => row.id)).toEqual([
    mappings[1].id,
    mappings[0].id,
  ]);
});
it('applies bulk membership deltas while preserving retained component identities', async () => {
  const f = await fixture();
  const services = await Promise.all(
    Array.from({ length: 4 }, (_, i) => createTestService(`Delta component ${i}`))
  );
  const existing = await Promise.all(
    services.slice(0, 3).map((service, i) =>
      db.statusPageService.create({
        data: {
          statusPageId: f.page.id,
          serviceId: service.id,
          displayName: `Component ${i}`,
          order: i,
        },
      })
    )
  );
  const page = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  const result = await saveStatusPageSection(
    f.page.id,
    {
      serviceIds: [services[0].id, services[1].id, services[3].id],
      serviceConfigs: {
        [services[0].id]: { displayName: 'Component 0', order: 0 },
        [services[1].id]: { displayName: 'Changed 1', order: 1 },
        [services[3].id]: { displayName: 'New 3', order: 3 },
      },
    },
    { id: f.credential.user.id },
    page.revision,
    'services'
  );
  expect(result.revision).toBe(page.revision + 4);
  expect(await db.statusPageService.findUniqueOrThrow({ where: { id: existing[0].id } })).toEqual(
    existing[0]
  );
  expect(
    await db.statusPageService.findUniqueOrThrow({ where: { id: existing[1].id } })
  ).toMatchObject({
    id: existing[1].id,
    createdAt: existing[1].createdAt,
    displayName: 'Changed 1',
  });
  expect(await db.statusPageService.findUnique({ where: { id: existing[2].id } })).toBeNull();
  expect(await db.statusPageService.count({ where: { statusPageId: f.page.id } })).toBe(3);
});

it('serializes mapping-only writes against one reviewed parent revision without losing concurrent edits', async () => {
  const { PATCH: updateService } =
    await import('@/app/api/v2/status-pages/[id]/services/[serviceId]/route');
  const f = await fixture();
  const services = await Promise.all([
    createTestService('Concurrent component A'),
    createTestService('Concurrent component B'),
  ]);
  const mappings = await Promise.all(
    services.map(service =>
      db.statusPageService.create({ data: { statusPageId: f.page.id, serviceId: service.id } })
    )
  );
  const page = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  const responses = await Promise.all(
    services.map((service, i) =>
      invokeV2(
        updateService,
        f.credential.token,
        'PATCH',
        `${f.path}/services/${service.id}`,
        { ...f.params, serviceId: service.id },
        { displayName: `Reviewed ${i}` },
        { 'If-Match': `"${page.revision}"` }
      )
    )
  );
  expect(responses.map(r => r.status).sort()).toEqual([200, 412]);
  const retained = await db.statusPageService.findMany({ where: { statusPageId: f.page.id } });
  expect(retained.map(row => row.id).sort()).toEqual(mappings.map(row => row.id).sort());
  expect(retained.filter(row => row.displayName !== null)).toHaveLength(1);
  expect(await db.auditLog.count({ where: { action: 'status_page.config.updated' } })).toBe(1);
});
