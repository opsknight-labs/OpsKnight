import { NextRequest } from 'next/server';
import type { AppRole } from '@/lib/authorization';
import type { NextRouteHandler } from '@/lib/api-v2/endpoint';
import { generateApiKey } from '@/lib/api-keys';
import { createTestUser, testPrisma } from './test-db';

export async function createV2Credential(scopes: string[], role: AppRole = 'ADMIN') {
  const user = await createTestUser({ role });
  const issued = generateApiKey();
  const key = await testPrisma.apiKey.create({
    data: {
      name: 'Isolated REST fixture',
      userId: user.id,
      scopes,
      prefix: issued.prefix,
      tokenHash: issued.tokenHash,
    },
  });
  return { user, key, token: issued.token };
}

export function invokeV2(
  handler: NextRouteHandler,
  token: string,
  method: string,
  path: string,
  params: Record<string, string>,
  body?: unknown,
  headers: Record<string, string> = {}
) {
  return handler(
    new NextRequest(`http://localhost/api/v2${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve(params) }
  );
}
