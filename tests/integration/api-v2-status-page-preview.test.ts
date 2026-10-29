import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/v2/status-pages/[id]/preview/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestStatusPage, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('previews the current sanitized projection without publishing or changing revision', async () => {
  const reader = await createV2Credential(['status-pages:read']);
  const page = await createTestStatusPage();
  const publicationBefore = await db.statusPageSnapshot.findUniqueOrThrow({ where: { statusPageId: page.id } });
  const path = `/status-pages/${page.id}/preview`;
  const response = await invokeV2(GET, reader.token, 'GET', path, { id: page.id });
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe(`"${page.revision}"`);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await response.json()).data).toMatchObject({
    pageId: page.id, revision: page.revision, available: true,
  });
  const publicationAfter = await db.statusPageSnapshot.findUniqueOrThrow({ where: { statusPageId: page.id } });
  expect(publicationAfter.revision).toBe(publicationBefore.revision);
  expect(publicationAfter.publishedRevision).toBe(publicationBefore.publishedRevision);
  expect(publicationAfter.servingState).toBe(publicationBefore.servingState);
  expect((await db.statusPage.findUniqueOrThrow({ where: { id: page.id } })).revision).toBe(page.revision);
});

it('does not expose previews to credentials without status-page read scope', async () => {
  const other = await createV2Credential(['services:read']);
  const page = await createTestStatusPage();
  const response = await invokeV2(GET, other.token, 'GET', `/status-pages/${page.id}/preview`, { id: page.id });
  expect(response.status).toBe(403);
});
