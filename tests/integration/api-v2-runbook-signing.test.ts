import { beforeEach, expect, it } from 'vitest';
import { GET as list, POST as stage } from '@/app/api/v2/runbooks/signing-identities/route';
import { POST as activate } from '@/app/api/v2/runbooks/signing-identities/[id]/activate/route';
import { POST as retire } from '@/app/api/v2/runbooks/signing-identities/[id]/retire/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
const scopes = ['runbook-signing:read', 'runbook-signing:write'];
it('preserves pin acknowledgement, retirement grace and canonical API attribution end to end', async () => {
  const credential = await createV2Credential(scopes);
  const nextResponse = await invokeV2(
    stage,
    credential.token,
    'POST',
    '/runbooks/signing-identities',
    {},
    { expectedActiveKeyId: null },
    { 'Idempotency-Key': 'stage-once' }
  );
  expect(nextResponse.status).toBe(201);
  const { data: next } = await nextResponse.json();
  expect(next.state).toBe('NEXT');
  const rows = await db.runbookExecutionSigningKey.findMany();
  const old = rows.find(row => row.state === 'ACTIVE')!;
  const agent = await db.runbookAgent.create({
    data: { name: 'Offline pin fixture', status: 'OFFLINE', trustedSigningKeys: [old.id] },
  });
  const activateNext = (key: string) =>
    invokeV2(
      activate,
      credential.token,
      'POST',
      `/runbooks/signing-identities/${next.id}/activate`,
      { id: next.id },
      { expectedActiveKeyId: old.id },
      { 'Idempotency-Key': key }
    );
  expect((await activateNext('missing-pin')).status).toBe(409);
  await db.runbookAgent.update({
    where: { id: agent.id },
    data: { trustedSigningKeys: [old.id, next.id] },
  });
  expect((await activateNext('activate-once')).status).toBe(200);
  expect((await activateNext('activate-once')).headers.get('idempotency-replayed')).toBe('true');
  expect((await activateNext('changed-active')).status).toBe(409);
  const retireOld = (key: string) =>
    invokeV2(
      retire,
      credential.token,
      'POST',
      `/runbooks/signing-identities/${old.id}/retire`,
      { id: old.id },
      { expectedState: 'RETIRING' },
      { 'Idempotency-Key': key }
    );
  expect((await retireOld('too-early')).status).toBe(409);
  await db.runbookExecutionSigningKey.update({
    where: { id: old.id },
    data: { retiredAt: new Date(Date.now() - 1) },
  });
  expect((await retireOld('retire-once')).status).toBe(200);
  const response = await invokeV2(
    list,
    credential.token,
    'GET',
    '/runbooks/signing-identities',
    {}
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  for (const row of rows) expect(text).not.toContain(row.privateKeyEncrypted);
  expect(text).not.toContain('privateKey');
  const audits = await db.auditLog.findMany({
    where: { action: { startsWith: 'runbook.signing.' } },
  });
  expect(audits.map(a => a.action).sort()).toEqual([
    'runbook.signing.activate',
    'runbook.signing.retire',
    'runbook.signing.staged',
  ]);
  for (const audit of audits)
    expect(audit.details).toMatchObject({
      source: 'API',
      metadata: expect.objectContaining({ apiClientId: credential.key.id }),
    });
  expect(JSON.stringify(await db.backgroundJob.findMany())).not.toContain('privateKeyEncrypted');
});
it('requires dedicated signing scope for both ADMIN and non-ADMIN credentials', async () => {
  for (const credential of [
    await createV2Credential(['admin:manage']),
    await createV2Credential(scopes, 'RESPONDER'),
  ]) {
    expect(
      (await invokeV2(list, credential.token, 'GET', '/runbooks/signing-identities', {})).status
    ).toBe(403);
    expect(
      (
        await invokeV2(
          stage,
          credential.token,
          'POST',
          '/runbooks/signing-identities',
          {},
          { expectedActiveKeyId: null },
          { 'Idempotency-Key': 'denied' }
        )
      ).status
    ).toBe(403);
  }
  expect(await db.runbookExecutionSigningKey.count()).toBe(0);
});
