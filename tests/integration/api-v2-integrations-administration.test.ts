import { beforeEach, expect, it } from 'vitest';
import { POST as createIntegration } from '@/app/api/v2/services/[id]/integrations/route';
import {
  POST as rotateCredentials,
  GET as getCredentialState,
} from '@/app/api/v2/integrations/[id]/credentials/route';
import { POST as testIntegration } from '@/app/api/v2/integrations/[id]/test/route';
import { GET as diagnostics } from '@/app/api/v2/integrations/[id]/diagnostics/route';
import {
  DELETE as deleteIntegration,
  GET as getIntegration,
  PATCH as patchIntegration,
} from '@/app/api/v2/integrations/[id]/route';
import { decryptStoredSecret } from '@/lib/encryption';
import { isIntegrationAuthorized } from '@/lib/integrations/auth';
import { NextRequest } from 'next/server';
import type { NextRouteHandler } from '@/lib/api-v2/endpoint';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db, createTestService } from '../helpers/test-db';

const getIntegrationRoute = getIntegration as unknown as NextRouteHandler;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('creates with scoped idempotency, validates without ingestion, rotates one-time secret with overlap, and safely deletes', async () => {
  const credential = await createV2Credential(
    [
      'integrations:read',
      'integrations:create',
      'integrations:credentials:write',
      'integrations:test',
      'integrations:delete',
    ],
    'ADMIN'
  );
  const service = await createTestService('REST integration administration');
  const path = `/services/${service.id}/integrations`;
  const create = () =>
    invokeV2(
      createIntegration,
      credential.token,
      'POST',
      path,
      { id: service.id },
      { name: 'Pager test' },
      { 'Idempotency-Key': 'integration-create-1' }
    );
  const [first, replay] = await Promise.all([create(), create()]);
  const [firstBody, replayBody] = await Promise.all([first.json(), replay.json()]);
  expect([first.status, replay.status]).toEqual([201, 201]);
  const disclosedKey = [firstBody.data.key, replayBody.data.key].find(
    value => typeof value === 'string'
  );
  expect(disclosedKey).toBeTruthy();
  expect([firstBody.data.key, replayBody.data.key].filter(value => value === null)).toHaveLength(1);
  expect(
    [first, replay].filter(response => response.headers.get('idempotency-replayed') === 'true')
  ).toHaveLength(1);
  expect(await db.auditLog.count({ where: { action: 'integration.created' } })).toBe(1);
  const integrationId = firstBody.data.id as string;
  const storedRoutingKey = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  expect(await decryptStoredSecret(storedRoutingKey.key)).toBe(disclosedKey);
  expect(storedRoutingKey.keyFingerprint).toBeTruthy();

  const detail = await invokeV2(
    getIntegrationRoute,
    credential.token,
    'GET',
    `/integrations/${integrationId}`,
    { id: integrationId }
  );
  expect(detail.status).toBe(200);
  const initialSecret = 'integration-signing-secret';
  await db.integration.update({
    where: { id: integrationId },
    data: { signatureSecret: initialSecret },
  });
  const current = await invokeV2(
    getCredentialState,
    credential.token,
    'GET',
    `/integrations/${integrationId}/credentials`,
    { id: integrationId }
  );
  expect(current.status).toBe(200);
  const rotate = () =>
    invokeV2(
      rotateCredentials,
      credential.token,
      'POST',
      `/integrations/${integrationId}/credentials`,
      { id: integrationId },
      { overlapSeconds: 600 },
      { 'If-Match': current.headers.get('etag')!, 'Idempotency-Key': 'integration-rotate-1' }
    );
  const rotated = await rotate();
  const rotatedBody = await rotated.json();
  expect(rotated.status).toBe(200);
  expect(rotatedBody.data.secret).toBeTruthy();
  expect(rotated.headers.get('etag')).toBe('"3"');
  const replayedRotation = await rotate();
  expect((await replayedRotation.json()).data.secret).toBeNull();
  const stored = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  expect(await decryptStoredSecret(stored.signatureSecret!)).toBe(rotatedBody.data.secret);
  expect(await decryptStoredSecret(stored.previousSignatureSecret!)).toBe(initialSecret);
  expect(stored.previousSignatureSecretExpiresAt).toBeTruthy();

  const keyRotation = await invokeV2(
    rotateCredentials,
    credential.token,
    'POST',
    `/integrations/${integrationId}/credentials`,
    { id: integrationId },
    { credential: 'routing-key', overlapSeconds: 600 },
    { 'If-Match': rotated.headers.get('etag')!, 'Idempotency-Key': 'integration-routing-rotate-1' }
  );
  const keyRotationBody = await keyRotation.json();
  expect(keyRotation.status).toBe(200);
  const afterKeyRotation = await db.integration.findUniqueOrThrow({ where: { id: integrationId } });
  const oldRoutingKey = await decryptStoredSecret(afterKeyRotation.previousKey!);
  expect(await decryptStoredSecret(afterKeyRotation.key)).toBe(keyRotationBody.data.secret);
  expect(afterKeyRotation.previousKeyFingerprint).toBeTruthy();
  expect(
    await isIntegrationAuthorized(
      new NextRequest(
        `https://example.test/api?integrationKey=${encodeURIComponent(oldRoutingKey)}`
      ),
      afterKeyRotation.key,
      afterKeyRotation.previousKey,
      afterKeyRotation.previousKeyExpiresAt
    )
  ).toBe(true);
  expect(
    await isIntegrationAuthorized(
      new NextRequest(
        `https://example.test/api?integrationKey=${encodeURIComponent(keyRotationBody.data.secret)}`
      ),
      afterKeyRotation.key,
      afterKeyRotation.previousKey,
      afterKeyRotation.previousKeyExpiresAt
    )
  ).toBe(true);
  expect(
    await isIntegrationAuthorized(
      new NextRequest(
        `https://example.test/api?integrationKey=${encodeURIComponent(oldRoutingKey)}`
      ),
      afterKeyRotation.key,
      afterKeyRotation.previousKey,
      new Date(Date.now() - 1000)
    )
  ).toBe(false);

  const validSample = {
    event_action: 'trigger',
    dedup_key: 'diag-1',
    payload: { summary: 'safe sample', source: 'test', severity: 'warning' },
  };
  const checked = await invokeV2(
    testIntegration,
    credential.token,
    'POST',
    `/integrations/${integrationId}/test`,
    { id: integrationId },
    { payload: validSample }
  );
  expect((await checked.json()).data).toMatchObject({
    valid: true,
    provider: 'EVENTS_API_V2',
    errors: [],
  });
  const rejected = await invokeV2(
    testIntegration,
    credential.token,
    'POST',
    `/integrations/${integrationId}/test`,
    { id: integrationId },
    { payload: { unsafe: true } }
  );
  expect((await rejected.json()).data.valid).toBe(false);
  expect(await db.incident.count()).toBe(0);
  expect(
    (
      await invokeV2(
        diagnostics,
        credential.token,
        'GET',
        `/integrations/${integrationId}/diagnostics`,
        { id: integrationId }
      )
    ).status
  ).toBe(200);

  const latest = await invokeV2(
    getIntegrationRoute,
    credential.token,
    'GET',
    `/integrations/${integrationId}`,
    { id: integrationId }
  );
  const remove = () =>
    invokeV2(
      deleteIntegration,
      credential.token,
      'DELETE',
      `/integrations/${integrationId}`,
      { id: integrationId },
      undefined,
      { 'If-Match': latest.headers.get('etag')!, 'Idempotency-Key': 'integration-delete-1' }
    );
  const removed = await remove();
  expect(removed.status).toBe(204);
  expect((await remove()).status).toBe(204);
  expect(await db.integration.findUnique({ where: { id: integrationId } })).toBeNull();
  expect(await db.auditLog.count({ where: { action: 'integration.deleted' } })).toBe(1);
});

it('rejects broad admin scope inheritance and prevents removal while inbound work is active', async () => {
  const admin = await createV2Credential(['admin:manage'], 'ADMIN');
  const service = await createTestService('Integration scope boundary');
  expect(
    (
      await invokeV2(
        createIntegration,
        admin.token,
        'POST',
        `/services/${service.id}/integrations`,
        { id: service.id },
        { name: 'No implicit scope' },
        { 'Idempotency-Key': 'deny-create' }
      )
    ).status
  ).toBe(403);

  const credential = await createV2Credential(
    ['integrations:read', 'integrations:delete'],
    'ADMIN'
  );
  const integration = await db.integration.create({
    data: { name: 'Busy inbound', type: 'EVENTS_API_V2', key: 'key-active', serviceId: service.id },
  });
  const detail = await invokeV2(
    getIntegrationRoute,
    credential.token,
    'GET',
    `/integrations/${integration.id}`,
    { id: integration.id }
  );
  await db.inboundDelivery.create({
    data: {
      integrationId: integration.id,
      provider: integration.type,
      deliveryHash: 'active',
      status: 'PROCESSING',
    },
  });
  const result = await invokeV2(
    deleteIntegration,
    credential.token,
    'DELETE',
    `/integrations/${integration.id}`,
    { id: integration.id },
    undefined,
    { 'If-Match': detail.headers.get('etag')!, 'Idempotency-Key': 'busy-delete' }
  );
  expect(result.status).toBe(409);
  expect(await db.integration.findUnique({ where: { id: integration.id } })).not.toBeNull();
});

it('updates without If-Match (no precondition) and still enforces one when supplied', async () => {
  const credential = await createV2Credential(['integrations:read', 'integrations:write'], 'ADMIN');
  const service = await createTestService('Unconditional integration update');
  const integration = await db.integration.create({
    data: {
      name: 'Before',
      type: 'WEBHOOK',
      key: 'k-' + crypto.randomUUID(),
      serviceId: service.id,
    },
  });
  const route = patchIntegration as unknown as NextRouteHandler;
  const unconditional = await invokeV2(
    route,
    credential.token,
    'PATCH',
    `/integrations/${integration.id}`,
    { id: integration.id },
    { name: 'After' }
  );
  expect(unconditional.status, JSON.stringify(await unconditional.clone().json())).toBe(200);
  expect((await db.integration.findUniqueOrThrow({ where: { id: integration.id } })).name).toBe(
    'After'
  );
  const stale = await invokeV2(
    route,
    credential.token,
    'PATCH',
    `/integrations/${integration.id}`,
    { id: integration.id },
    { name: 'Stale' },
    { 'If-Match': '"1"' }
  );
  expect(stale.status).toBe(412);
  expect((await db.integration.findUniqueOrThrow({ where: { id: integration.id } })).name).toBe(
    'After'
  );
});
