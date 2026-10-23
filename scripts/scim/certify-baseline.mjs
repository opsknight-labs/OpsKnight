/* eslint-disable security/detect-non-literal-fs-filename -- All paths are confined to the generated mkdtemp certification fixture and removed in finally. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith('/enterprise_scim_test')
)
  throw new Error('Use the isolated enterprise_scim_test database.');
const reference = process.env.SCIM_BASELINE_COMMIT ?? '326f21685';
const generated = mkdtempSync(join(process.cwd(), 'tests/integration/scim-generated-'));
const testPath = join(generated, 'baseline.test.ts');
const modules = {
  user: 'src/app/api/scim/v2/Users/[id]/route.ts',
  group: 'src/app/api/scim/v2/Groups/[id]/route.ts',
};
const test = baseline => `
// @vitest-environment node
import { describe, beforeAll, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashToken } from '@/lib/scim/security/credentials';
import { PATCH } from '${baseline ? './user.ts' : '@/app/api/scim/v2/Users/[id]/route'}';
import { GET, DELETE } from '${baseline ? './group.ts' : '@/app/api/scim/v2/Groups/[id]/route'}';
vi.mock('@/lib/auth-control/actor', () => ({ getControlActor: vi.fn(), lockControlActor: vi.fn() }));
const stamp = Date.now().toString();
const token = 'baseline-route-regression-credential-' + stamp;
let userId, teamId;
const context = id => ({ params: Promise.resolve({ id }) });
const request = (method, body) => new NextRequest('https://baseline.test/api/scim/v2/Users', { method, headers: { authorization: 'Bearer ' + token }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeAll(async () => {
 const connector = await prisma.scimConnector.create({ data: { name: 'Disposable baseline fixture ' + stamp } });
 await prisma.scimCredential.create({ data: { connectorId: connector.id, name: 'Fixture', tokenHash: hashToken(token), tokenHint: token.slice(-4), scopes: ['users:read','users:write','groups:read','groups:write'], createdBy: 'certifier', expiresAt: new Date(Date.now()+3600000) } });
 const user = await prisma.user.create({ data: { email: 'baseline-' + stamp + '@example.test', name:'Fixture', role:'ADMIN', roleSource:'OIDC', status:'ACTIVE', scimExternalId:'baseline-' + stamp } });
 userId = user.id;
 await prisma.scimIdentity.create({ data: { connectorId: connector.id, userId, externalId: user.scimExternalId } });
 const team = await prisma.team.create({ data: { name: 'Unmanaged baseline team ' + stamp } }); teamId = team.id;
 await prisma.service.create({ data: { name:'Baseline service '+stamp, teamId } });
});
describe('historical SCIM defect regressions', () => {
 it('profile PATCH preserves OIDC role authority', async () => {
  expect((await PATCH(request('PATCH',{ Operations:[{op:'replace',path:'displayName',value:'Updated fixture'}]}),context(userId))).status).toBe(200);
  expect((await prisma.user.findUniqueOrThrow({where:{id:userId}})).roleSource).toBe('OIDC');
 });
 it('directory credential cannot discover unmanaged operational team', async () => { expect((await GET(request('GET'),context(teamId))).status).toBe(404); });
 it('directory deletion cannot destroy an unmanaged team or service ownership', async () => {
  const response = await DELETE(request('DELETE'),context(teamId));
  expect({status:response.status,teams:await prisma.team.count({where:{id:teamId}}),services:await prisma.service.count({where:{teamId}})}).toEqual({status:404,teams:1,services:1});
 });
});
`;
try {
  for (const [name, path] of Object.entries(modules))
    writeFileSync(
      join(generated, `${name}.ts`),
      execFileSync('git', ['show', `${reference}:${path}`])
    );
  writeFileSync(testPath, test(true));
  let failuresObserved = false;
  try {
    execFileSync(
      'npx',
      [
        'vitest',
        'run',
        '--no-file-parallelism',
        '--maxWorkers=1',
        relative(process.cwd(), testPath),
      ],
      { env: { ...process.env, VITEST_USE_REAL_DB: '1' }, stdio: 'pipe' }
    );
  } catch (error) {
    const output = String(error.stdout) + String(error.stderr);
    failuresObserved = /3 failed/.test(output);
    if (!failuresObserved) {
      process.stdout.write(output);
      throw new Error('Baseline failed for an unexpected reason.');
    }
  }
  if (!failuresObserved)
    throw new Error('The selected baseline did not reproduce all three defects.');
  writeFileSync(testPath, test(false));
  execFileSync(
    'npx',
    ['vitest', 'run', '--no-file-parallelism', '--maxWorkers=1', relative(process.cwd(), testPath)],
    { env: { ...process.env, VITEST_USE_REAL_DB: '1' }, stdio: 'pipe' }
  );
  console.log(
    JSON.stringify({
      baselineCommit: reference,
      preChangeRouteRegressions: 3,
      baseline: '3 expected failures observed',
      current: '3 passed',
      fixture: 'isolated PostgreSQL; shared current credential harness',
    })
  );
} finally {
  rmSync(generated, { recursive: true, force: true });
}
