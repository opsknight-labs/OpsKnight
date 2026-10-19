import { beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { testPrisma, resetDatabase } from '../helpers/test-db';
import { purgeExpiredAgentNonces, NONCE_PURGE_BATCH_SIZE } from '@/lib/runbooks/nonce-cleanup';
import { agentSignaturePayload, authenticateAgentRequest, sha256 } from '@/lib/runbooks/agent-auth';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import {
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
} from '@/lib/metrics/operational/registry';

const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
const keys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});
function request(agentId: string, nonce: string, timestamp = new Date().toISOString()) {
  const url = 'https://fixture.invalid/api/runbook-agent/v1/heartbeat';
  const signature = sign(
    null,
    Buffer.from(
      agentSignaturePayload({ method: 'POST', target: url, nonce, timestamp, body: '{}' })
    ),
    keys.privateKey
  ).toString('base64');
  return new Request(url, {
    method: 'POST',
    body: '{}',
    headers: {
      'x-opsknight-agent-id': agentId,
      'x-opsknight-nonce': nonce,
      'x-opsknight-timestamp': timestamp,
      'x-opsknight-signature': signature,
    },
  });
}
async function agent() {
  return testPrisma.runbookAgent.create({
    data: { name: 'Nonce maintenance fixture', publicKey: keys.publicKey },
  });
}
suite('isolated bounded Agent nonce maintenance', () => {
  beforeEach(async () => {
    await resetDatabase();
    clearRuntimeOperationalMetrics();
  }, 60000);
  it('purges an indexed batch from 10000 expired records while rejecting fresh and future-dated request replays', async () => {
    const identity = await agent();
    for (let batch = 0; batch < 10; batch++)
      await testPrisma.runbookAgentRequestNonce.createMany({
        data: Array.from({ length: 1000 }, (_, index) => ({
          agentId: identity.id,
          nonceHash: sha256(`expired-${batch}-${index}`),
          createdAt: batch === 0 && index === 0 ? new Date(0) : new Date(Date.now() - 3600000),
        })),
      });
    const current = request(identity.id, 'current');
    const future = request(identity.id, 'future', new Date(Date.now() + 4 * 60000).toISOString());
    await authenticateAgentRequest(current, '{}');
    await authenticateAgentRequest(future, '{}');
    await testPrisma.$executeRaw`ANALYZE "RunbookAgentRequestNonce"`;
    const plan =
      await testPrisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM "RunbookAgentRequestNonce" WHERE "createdAt" < timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '11 minutes' ORDER BY "createdAt" LIMIT 1000`;
    const [purged, replay, futureReplay, fresh] = await Promise.allSettled([
      purgeExpiredAgentNonces(testPrisma),
      authenticateAgentRequest(current, '{}'),
      authenticateAgentRequest(future, '{}'),
      authenticateAgentRequest(request(identity.id, 'new'), '{}'),
    ]);
    expect(purged).toMatchObject({
      status: 'fulfilled',
      value: { count: NONCE_PURGE_BATCH_SIZE, hasMore: true, skipped: false },
    });
    for (const result of [replay, futureReplay])
      expect(result).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ message: 'Agent request replay detected.' }),
      });
    expect(fresh.status).toBe('fulfilled');
    expect(await testPrisma.runbookAgentRequestNonce.count()).toBe(
      10000 - NONCE_PURGE_BATCH_SIZE + 3
    );
    expect(JSON.stringify(plan)).toContain('RunbookAgentRequestNonce_createdAt_idx');
    expect(
      runtimeOperationalMetrics().get('opsknight_runbook_nonce_purge_rows_total')?.[0].value
    ).toBe(NONCE_PURGE_BATCH_SIZE);
    expect(
      runtimeOperationalMetrics().get(
        'opsknight_runbook_nonce_purge_oldest_expired_age_seconds'
      )?.[0].value
    ).toBeGreaterThan(2000);
    expect(
      await testPrisma.runbookAgentRequestNonce.findUnique({
        where: {
          agentId_nonceHash: { agentId: identity.id, nonceHash: sha256('expired-0-0') },
        },
      })
    ).toBeNull();
    // Removing an expired nonce never makes an out-of-window signed request valid again.
    await expect(
      authenticateAgentRequest(
        request(identity.id, 'expired-0-0', new Date(Date.now() - 3600000).toISOString()),
        '{}'
      )
    ).rejects.toThrow('outside the allowed window');
  });
  it('times out a stalled purge without blocking replay rejection, new authentication or execution recovery', async () => {
    const identity = await agent();
    const replay = request(identity.id, 'retained');
    await authenticateAgentRequest(replay, '{}');
    await testPrisma.runbookAgentRequestNonce.create({
      data: { agentId: identity.id, nonceHash: sha256('old'), createdAt: new Date(0) },
    });
    const workflow = await testPrisma.runbook.create({
      data: { name: 'Recovery isolation', slug: crypto.randomUUID() },
    });
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 1,
        state: 'PUBLISHED',
        checksum: 'a'.repeat(64),
        definition: { steps: [] },
      },
    });
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: workflow.id,
        runbookVersionId: version.id,
        definitionChecksum: version.checksum,
        status: 'WAITING_AGENT',
        deadlineAt: new Date(0),
      },
    });
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set('connection_limit', '1');
    const maintenance = new PrismaClient({ datasourceUrl: url.toString() });
    const recovery = new PrismaClient({ datasourceUrl: url.toString() });
    await testPrisma.$executeRawUnsafe(
      `CREATE FUNCTION rbe_slow_nonce_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3); RETURN OLD; END $$`
    );
    await testPrisma.$executeRawUnsafe(
      `CREATE TRIGGER rbe_slow_nonce_fixture BEFORE DELETE ON "RunbookAgentRequestNonce" FOR EACH ROW EXECUTE FUNCTION rbe_slow_nonce_fixture()`
    );
    let purge: Promise<unknown> | undefined;
    try {
      purge = purgeExpiredAgentNonces(maintenance).catch(error => error);
      let deleting = false;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const [row] = await testPrisma.$queryRaw<
          Array<{ busy: boolean }>
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep' AND query LIKE 'DELETE%RunbookAgentRequestNonce%') AS busy`;
        if (row.busy) {
          deleting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(deleting).toBe(true);
      const outcomes = await Promise.allSettled([
        authenticateAgentRequest(replay, '{}'),
        authenticateAgentRequest(request(identity.id, 'during-purge'), '{}'),
        recovery.$transaction(tx => reconcileRunbooks(10, tx), { timeout: 2000 }),
      ]);
      expect(outcomes[0]).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ message: 'Agent request replay detected.' }),
      });
      expect(outcomes[1].status).toBe('fulfilled');
      expect(outcomes[2].status).toBe('fulfilled');
      expect(
        (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: execution.id } }))
          .status
      ).toBe('TIMED_OUT');
      expect(await purge).toBeInstanceOf(Error);
      expect(await testPrisma.runbookAgentRequestNonce.count()).toBe(3);
      expect(
        runtimeOperationalMetrics().get('opsknight_runbook_nonce_purge_batches_total')
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ labels: { result: 'failed' }, value: 1 }),
        ])
      );
    } finally {
      await purge;
      await testPrisma.$executeRawUnsafe(
        'DROP TRIGGER rbe_slow_nonce_fixture ON "RunbookAgentRequestNonce"'
      );
      await testPrisma.$executeRawUnsafe('DROP FUNCTION rbe_slow_nonce_fixture()');
      await Promise.all([maintenance.$disconnect(), recovery.$disconnect()]);
    }
  }, 15000);
});
