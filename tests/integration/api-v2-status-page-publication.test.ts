import { beforeEach, expect, it } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import { GET as read } from '@/app/api/v2/status-pages/[id]/publication/route';
import { POST as retry } from '@/app/api/v2/status-pages/[id]/publication/retry/route';
import { GET as getJob } from '@/app/api/v2/status-pages/[id]/publication/jobs/[jobId]/route';
import { processJob } from '@/lib/jobs/queue';
import { processStatusPagePublicationRetry } from '@/lib/status-pages/publication-jobs';
import { getStatusPageServingStore } from '@/lib/status-pages/serving-store';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fixture() {
  const credential = await createV2Credential(['status-pages:read', 'status-pages:write']);
  const page = await db.statusPage.create({
    data: { name: 'Publication retry', slug: `retry-${crypto.randomUUID()}`, enabled: true },
  });
  await publishStatusPageSnapshot(page.id);
  const path = `/status-pages/${page.id}/publication`;
  const headers = { 'If-Match': `"${page.revision}"`, 'Idempotency-Key': crypto.randomUUID() };
  const params = { id: page.id };
  const call = () =>
    invokeV2(retry, credential.token, 'POST', `${path}/retry`, params, {}, headers);
  return { credential, page, path, headers, params, call };
}
it('reports persisted state, accepts one durable job and exposes the real worker outcome', async () => {
  const f = await fixture();
  const response = await invokeV2(read, f.credential.token, 'GET', f.path, f.params);
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe(`"${f.page.revision}"`);
  expect((await response.json()).data.publication.status).toBe('LIVE');
  const accepted = await f.call();
  expect(accepted.status).toBe(202);
  const job = (await accepted.json()).data;
  expect(accepted.headers.get('location')).toBe(`/api/v2${f.path}/jobs/${job.id}`);
  expect(job).toMatchObject({ status: 'PENDING', result: null });
  const replay = await f.call();
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data.id).toBe(job.id);
  expect(await db.backgroundJob.count({ where: { status: 'PENDING' } })).toBe(1);
  expect(await processJob(job.id)).toBe(true);
  const finished = await invokeV2(getJob, f.credential.token, 'GET', `${f.path}/jobs/${job.id}`, {
    ...f.params,
    jobId: job.id,
  });
  expect(finished.status).toBe(200);
  const data = (await finished.json()).data;
  expect(data).toMatchObject({ status: 'COMPLETED', result: { publication: { status: 'LIVE' } } });
  expect(data).not.toHaveProperty('payload');
  expect(data).not.toHaveProperty('error');
  await processStatusPagePublicationRetry(job.id);
  const audits = await db.auditLog.findMany({
    where: { action: 'status_page.publication.retried' },
  });
  expect(audits).toHaveLength(1);
  expect(audits[0].details).toMatchObject({
    source: 'API',
    metadata: { apiClientId: f.credential.key.id, jobId: job.id },
  });
});
it('requires concrete current revision, a retry key and strict input before accepting work', async () => {
  const f = await fixture();
  for (const [headers, status] of [
    [{}, 428],
    [{ 'If-Match': '*', 'Idempotency-Key': 'wildcard' }, 400],
    [{ 'If-Match': `"${f.page.revision}"` }, 400],
    [{ 'If-Match': '"0"', 'Idempotency-Key': 'stale' }, 412],
  ] as const) {
    expect(
      (await invokeV2(retry, f.credential.token, 'POST', `${f.path}/retry`, f.params, {}, headers))
        .status
    ).toBe(status);
  }
  expect(
    (
      await invokeV2(
        retry,
        f.credential.token,
        'POST',
        `${f.path}/retry`,
        f.params,
        { forcePublic: true },
        f.headers
      )
    ).status
  ).toBe(400);
  expect(await db.backgroundJob.count()).toBe(0);
});
it.each(['RESPONDER', 'AUDITOR', 'USER'] as const)(
  'denies %s administrative retries and applies the existing read policy',
  async role => {
    const f = await fixture();
    const key = await createV2Credential(['status-pages:read', 'status-pages:write'], role);
    expect(
      (await invokeV2(retry, key.token, 'POST', `${f.path}/retry`, f.params, {}, f.headers)).status
    ).toBe(403);
    expect((await invokeV2(read, key.token, 'GET', f.path, f.params)).status).toBe(
      role === 'USER' ? 403 : 200
    );
  }
);
it('checks scope and current role again on a replay', async () => {
  const f = await fixture();
  expect((await f.call()).status).toBe(202);
  await db.user.update({ where: { id: f.credential.user.id }, data: { role: 'AUDITOR' } });
  expect((await f.call()).status).toBe(403);
  const key = await createV2Credential(['status-pages:read']);
  expect(
    (await invokeV2(retry, key.token, 'POST', `${f.path}/retry`, f.params, {}, f.headers)).status
  ).toBe(403);
});
it('rejects unrelated queue jobs and nested page ownership mismatches', async () => {
  const f = await fixture();
  const accepted = await f.call();
  const job = (await accepted.json()).data;
  const other = await db.statusPage.create({
    data: { name: 'Other page', slug: `other-${crypto.randomUUID()}` },
  });
  expect(
    (
      await invokeV2(
        getJob,
        f.credential.token,
        'GET',
        `/status-pages/${other.id}/publication/jobs/${job.id}`,
        { id: other.id, jobId: job.id }
      )
    ).status
  ).toBe(404);
  const unrelated = await db.backgroundJob.create({
    data: {
      id: crypto.randomUUID(),
      type: 'SCHEDULED_TASK',
      scheduledAt: new Date(),
      payload: { task: 'UNRELATED', secret: 'private' },
    },
  });
  expect(
    (
      await invokeV2(getJob, f.credential.token, 'GET', `${f.path}/jobs/${unrelated.id}`, {
        ...f.params,
        jobId: unrelated.id,
      })
    ).status
  ).toBe(404);
});
it('preserves a withdrawn privacy projection and rejects a replaced worker claim', async () => {
  const f = await fixture();
  await getStatusPageServingStore().revoke(f.page.id, 'PRIVACY');
  await db.statusPage.update({
    where: { id: f.page.id },
    data: { enabled: false, showIncidentTitles: false },
  });
  const current = await db.statusPage.findUniqueOrThrow({ where: { id: f.page.id } });
  f.headers['If-Match'] = `"${current.revision}"`;
  const job = (await (await f.call()).json()).data;
  await db.backgroundJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING', claimToken: crypto.randomUUID() },
  });
  await expect(processStatusPagePublicationRetry(job.id, crypto.randomUUID())).rejects.toThrow(
    'claim'
  );
  expect(await db.auditLog.count({ where: { action: 'status_page.publication.retried' } })).toBe(0);
  expect(await processJob(job.id)).toBe(true);
  expect(await getStatusPageServingStore().readLastGoodSnapshot(f.page.id)).toBeNull();
  const completed = await invokeV2(getJob, f.credential.token, 'GET', `${f.path}/jobs/${job.id}`, {
    ...f.params,
    jobId: job.id,
  });
  expect((await completed.json()).data.result.publication.status).toBe('DISABLED');
});

it('rolls back the worker audit and receipt together, then completes once on retry', async () => {
  const f = await fixture();
  const job = (await (await f.call()).json()).data;
  const claim = crypto.randomUUID();
  await db.backgroundJob.update({
    where: { id: job.id },
    data: { status: 'PROCESSING', claimToken: claim },
  });
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_publication_retry_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'status_page.publication.retried' THEN RAISE EXCEPTION 'Retry audit unavailable'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_publication_retry_audit_failure_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_publication_retry_audit_failure()'
  );
  try {
    await expect(processStatusPagePublicationRetry(job.id, claim)).rejects.toThrow();
    expect(
      (await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).payload
    ).not.toHaveProperty('receipt');
    expect(await db.auditLog.count({ where: { action: 'status_page.publication.retried' } })).toBe(
      0
    );
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER test_publication_retry_audit_failure_trigger ON "AuditLog"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION test_publication_retry_audit_failure()');
  }
  await processStatusPagePublicationRetry(job.id, claim);
  await processStatusPagePublicationRetry(job.id, claim);
  expect(await db.auditLog.count({ where: { action: 'status_page.publication.retried' } })).toBe(1);
  expect(
    (await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).payload
  ).toHaveProperty('receipt');
});

it('accepts concurrent matching keys once and never duplicates request audit', async () => {
  const f = await fixture();
  const responses = await Promise.all([f.call(), f.call()]);
  expect(responses.map(r => r.status)).toEqual([202, 202]);
  const jobs = await Promise.all(responses.map(async r => (await r.json()).data.id));
  expect(new Set(jobs).size).toBe(1);
  expect(await db.backgroundJob.count({ where: { status: 'PENDING' } })).toBe(1);
  expect(
    await db.auditLog.count({ where: { action: 'status_page.publication.retry_requested' } })
  ).toBe(1);
});
it('rolls back acceptance, request audit and replay on request-audit failure', async () => {
  const f = await fixture();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_publication_acceptance_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'status_page.publication.retry_requested' THEN RAISE EXCEPTION 'Acceptance audit unavailable'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER test_publication_acceptance_audit_failure_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_publication_acceptance_audit_failure()'
  );
  try {
    expect((await f.call()).status).toBe(500);
    expect(await db.backgroundJob.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER test_publication_acceptance_audit_failure_trigger ON "AuditLog"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION test_publication_acceptance_audit_failure()');
  }
  expect((await f.call()).status).toBe(202);
  expect(await db.backgroundJob.count({ where: { status: 'PENDING' } })).toBe(1);
  expect(
    await db.auditLog.count({ where: { action: 'status_page.publication.retry_requested' } })
  ).toBe(1);
});
