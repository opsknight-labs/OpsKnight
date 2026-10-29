import { readFileSync } from 'node:fs';
import { beforeEach, expect, it } from 'vitest';
import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { V2_MUTATION_CONTRACT } from '@/lib/api-v2/mutation-contract';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';

// Exercise the actual shared factory, authentication, transaction and persistent replay
// path for every registered mutation opting into that factory's revision/idempotency contract.
const operations = Object.entries(V2_MUTATION_CONTRACT)
  .filter(([operation, contract]) => {
    if (!contract.preconditionRequired || contract.concurrency !== 'etag') return false;
    const path = operation.split(' ')[1].replace('/api/v2', 'src/app/api/v2');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- authoritative registry supplies repository-owned paths
    return /idempotent:\s*true/.test(readFileSync(`${path}/route.ts`, 'utf8'));
  })
  .map(([operation]) => operation);
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
it.each(operations)('shared revision/replay contract: %s', async operation => {
  const credential = await createV2Credential(['status-pages:write']);
  let currentRevision = 1;
  const handler = defineV2Route({
    action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
    bodySchema: z.object({ name: z.string() }).strict(),
    preconditionRequired: true,
    idempotent: true,
    idempotencyRequired: true,
    handler: async ({ req, tx }) => {
      expect(requireRevisionIfMatch(req)).toBe(currentRevision);
      const event = await tx!.auditLog.create({
        data: { action: 'test.revision.mutation', entityType: 'SYSTEM_CONFIG' },
      });
      currentRevision++;
      return { data: { id: event.id } };
    },
  });
  const [method, template] = operation.split(' ');
  const path = template.replace('/api/v2', '').replace(/\[\w+\]/g, 'fixture');
  const request = (validator?: string, name = 'reviewed') =>
    invokeV2(
      handler,
      credential.token,
      method,
      path,
      {},
      { name },
      { 'Idempotency-Key': 'reviewed-operation', ...(validator ? { 'If-Match': validator } : {}) }
    );
  const first = await request('"1"');
  expect(first.status).toBe(200);
  const id = (await first.json()).data.id;
  const replay = await request(' "01" ');
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data.id).toBe(id);
  expect((await request('"2"')).status).toBe(409);
  expect((await request('"1"', 'different body')).status).toBe(409);
  expect((await request()).status).toBe(428);
  expect((await request('*')).status).toBe(400);
  expect((await request('W/"1"')).status).toBe(412);
  expect(await db.auditLog.count({ where: { action: 'test.revision.mutation' } })).toBe(1);
  expect(currentRevision).toBe(2);
});
