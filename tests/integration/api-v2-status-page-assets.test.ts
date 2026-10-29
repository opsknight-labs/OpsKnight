import { beforeEach, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v2/status-pages/[id]/assets/route';
import { DELETE } from '@/app/api/v2/status-pages/[id]/assets/[assetId]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('lists asset metadata and deletes only unreferenced images with replay-safe audit', async () => {
  const writer = await createV2Credential(['status-pages:write', 'status-pages:read']);
  const reader = await createV2Credential(['status-pages:read']);
  const page = await db.statusPage.create({ data: { name: 'Asset lifecycle', slug: 'asset-lifecycle' } });
  const path = `/status-pages/${page.id}/assets`;
  const uploaded = await invokeV2(POST, writer.token, 'POST', path, { id: page.id }, { image });
  const asset = (await uploaded.json()).data;
  const list = await invokeV2(GET, reader.token, 'GET', path, { id: page.id });
  expect(list.status).toBe(200);
  expect((await list.json()).data.assets).toMatchObject([{ assetId: asset.assetId, contentType: 'image/png' }]);
  const deletePath = `${path}/${asset.assetId}`;
  const params = { id: page.id, assetId: asset.assetId };
  await db.statusPage.update({ where: { id: page.id }, data: { branding: { logoUrl: asset.url } } });
  expect((await invokeV2(DELETE, writer.token, 'DELETE', deletePath, params, undefined,
    { 'Idempotency-Key': 'delete-in-use' })).status).toBe(409);
  await db.statusPage.update({ where: { id: page.id }, data: { branding: {} } });
  await db.statusPageSnapshot.upsert({
    where: { statusPageId: page.id },
    create: { statusPageId: page.id, payload: { branding: { logoUrl: asset.url } } },
    update: { payload: { branding: { logoUrl: asset.url } } },
  });
  expect((await invokeV2(DELETE, writer.token, 'DELETE', deletePath, params, undefined,
    { 'Idempotency-Key': 'delete-published' })).status).toBe(409);
  await db.statusPageSnapshot.update({ where: { statusPageId: page.id }, data: { payload: {} } });
  const headers = { 'Idempotency-Key': 'delete-unused-asset' };
  expect((await invokeV2(DELETE, reader.token, 'DELETE', deletePath, params, undefined, headers)).status).toBe(403);
  expect((await invokeV2(DELETE, writer.token, 'DELETE', deletePath, params, undefined, headers)).status).toBe(204);
  expect((await invokeV2(DELETE, writer.token, 'DELETE', deletePath, params, undefined, headers))
    .headers.get('idempotency-replayed')).toBe('true');
  expect(await db.statusPageAsset.count({ where: { id: asset.assetId } })).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'status_page.asset_deleted', entityId: page.id } })).toBe(1);
});

it('validates, deduplicates and scopes uploaded branding bytes without publishing them', async () => {
  const writer = await createV2Credential(['status-pages:write']);
  const reader = await createV2Credential(['status-pages:read']);
  const page = await db.statusPage.create({ data: { name: 'Asset page', slug: 'asset-page' } });
  const path = `/status-pages/${page.id}/assets`;
  const invoke = (token: string, payload: unknown) => invokeV2(POST, token, 'POST', path, { id: page.id }, payload);
  expect((await invoke(reader.token, { image })).status).toBe(403);
  expect((await invoke(writer.token, { image: 'data:image/png;base64,aW52YWxpZA==' })).status).toBe(400);
  const first = await invoke(writer.token, { image });
  expect(first.status).toBe(201);
  const data = (await first.json()).data;
  expect(data).toMatchObject({ contentType: 'image/png' });
  expect(data.url).toContain(`/api/status-page/logo/${page.id}?asset=`);
  expect((await invoke(writer.token, { image })).status).toBe(201);
  const count = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "StatusPageAsset" WHERE "statusPageId" = ${page.id}
  `;
  expect(count[0].count).toBe(BigInt(1));
  const audits = await db.auditLog.findMany({ where: { action: 'status_page.asset_uploaded', entityId: page.id } });
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain(image);
  const unchanged = await db.statusPage.findUniqueOrThrow({ where: { id: page.id } });
  expect(unchanged.revision).toBe(page.revision);
  expect(unchanged.branding).toBeNull();
});
