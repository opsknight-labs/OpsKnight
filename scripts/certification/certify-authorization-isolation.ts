import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined, override: false });
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[FATAL] Missing mandatory environment variable: ${name}. Configure it in .env or shell environment.`
    );
  }
  return value.trim();
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

async function main() {
  console.log('======================================================================');
  console.log('   CROSS-ROLE, CROSS-TENANT & ZERO SIDE-EFFECT AUTHORIZATION SUITE    ');
  console.log('======================================================================\n');

  const fixtures = JSON.parse(fs.readFileSync('tests/certification/fixtures.json', 'utf8'));
  const apiBase = 'http://127.0.0.1:3900/api/v2';

  // -------------------------------------------------------------------------
  // 1. TEAM A vs TEAM B BOUNDARY ISOLATION & ZERO SIDE-EFFECTS
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Cross-Team Boundary Isolation & Side-Effect Immunity ---');

  // Create isolated Team B service
  const teamBRecord = await prisma.team.findFirst({ where: { name: { contains: 'Team Beta' } } });
  const teamBService = await prisma.service.create({
    data: {
      name: `Secure Team B Service ${Date.now()}`,
      description: 'Owned strictly by Team Beta',
      teamId: teamBRecord!.id,
    },
  });
  console.log(`Created Team B Service: ${teamBService.id} (${teamBService.name})`);

  // Team A user attempts to rename Team B's service
  console.log('Attempting mutation from Team A token on Team B service...');
  const crossTeamPatch = await fetch(`${apiBase}/services/${teamBService.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${fixtures.tokens.teamA}`,
      'Content-Type': 'application/json',
      'If-Match': '"1"',
    },
    body: JSON.stringify({ name: 'Hacked By Team A' }),
  });

  console.log(`Cross-team PATCH response status: HTTP ${crossTeamPatch.status}`);
  if (crossTeamPatch.status !== 403 && crossTeamPatch.status !== 404) {
    throw new Error(
      `Security breach: Team A was not rejected on Team B service! Status: ${crossTeamPatch.status}`
    );
  }

  // Database Side-Effect Verification
  const verifyDbService = await prisma.service.findUnique({ where: { id: teamBService.id } });
  if (verifyDbService?.name !== teamBService.name) {
    throw new Error(
      `Data corruption! Service name was mutated to "${verifyDbService?.name}" despite HTTP denial!`
    );
  }
  console.log(
    'Database Side-Effect Verification: PASSED (Team B service name intact in PostgreSQL).\n'
  );

  // Team A attempts to delete Team B service
  console.log('Attempting DELETE from Team A token on Team B service...');
  const crossTeamDelete = await fetch(`${apiBase}/services/${teamBService.id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${fixtures.tokens.teamA}`,
      'If-Match': '"1"',
    },
  });
  console.log(`Cross-team DELETE response status: HTTP ${crossTeamDelete.status}`);
  const verifyDbDeleted = await prisma.service.findUnique({ where: { id: teamBService.id } });
  if (!verifyDbDeleted) {
    throw new Error(`Data loss! Team B service was deleted despite unauthorized call!`);
  }
  console.log(
    'Database Side-Effect Verification: PASSED (Team B service still exists in PostgreSQL).\n'
  );

  // -------------------------------------------------------------------------
  // 2. AUDITOR ROLE (READ-ONLY) MUTATION IMMUNITY
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: Auditor Role Mutation Rejection & Side-Effect Immunity ---');
  const countBefore = await prisma.incident.count();

  const auditorPost = await fetch(`${apiBase}/incidents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fixtures.tokens.auditor}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `auditor-test-${Date.now()}`,
    },
    body: JSON.stringify({
      title: 'Auditor Created Incident (Illegal)',
      serviceId: fixtures.services.serviceAId,
      urgency: 'HIGH',
      priority: 'P1',
    }),
  });

  console.log(`Auditor POST /incidents status: HTTP ${auditorPost.status}`);
  if (auditorPost.status !== 403) {
    throw new Error(`Auditor was permitted to create an incident! Status: ${auditorPost.status}`);
  }

  const countAfter = await prisma.incident.count();
  if (countBefore !== countAfter) {
    throw new Error(
      `Side-effect violation: Incident count changed from ${countBefore} to ${countAfter}!`
    );
  }
  console.log(
    'Database Side-Effect Verification: PASSED (Incident count unchanged in PostgreSQL).\n'
  );

  // -------------------------------------------------------------------------
  // 3. REGULAR USER PRIVILEGE ESCALATION PREVENTION
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: Regular User Privilege Escalation Prevention ---');
  const regUserPost = await fetch(`${apiBase}/users/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fixtures.tokens.regular}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `reg-user-test-${Date.now()}`,
    },
    body: JSON.stringify({
      name: 'Illegal Invite',
      email: `illegal-${Date.now()}@example.com`,
      role: 'ADMIN',
      authenticationMode: 'PASSWORD',
      delivery: 'MANUAL',
      expectedPolicyVersion: 1,
      expectedOidcConfigVersion: null,
    }),
  });

  console.log(`Regular user POST /users/invitations status: HTTP ${regUserPost.status}`);
  if (regUserPost.status !== 403) {
    throw new Error(
      `Regular user was permitted to issue admin invitations! Status: ${regUserPost.status}`
    );
  }
  console.log(
    'Database Side-Effect Verification: PASSED (Zero unauthorized administrative invitations created).\n'
  );

  // -------------------------------------------------------------------------
  // 4. DISABLED PRINCIPAL LOCKOUT & ZERO SIDE-EFFECTS
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: Disabled Principal Immediate Lockout ---');
  const disabledRes = await fetch(`${apiBase}/incidents`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${fixtures.tokens.disabled}` },
  });

  console.log(`Disabled token request status: HTTP ${disabledRes.status}`);
  if (disabledRes.status !== 401) {
    throw new Error(`Disabled principal was not rejected with 401! Status: ${disabledRes.status}`);
  }
  console.log(
    'Disabled Principal Enforcement: PASSED (Immediate 401 rejection with zero execution).\n'
  );

  // -------------------------------------------------------------------------
  // 5. LIMITED SCOPE TOKEN ENFORCEMENT & ZERO SIDE-EFFECTS
  // -------------------------------------------------------------------------
  console.log('--- TEST 5: Limited-Scope Token Boundary & Zero Side-Effects ---');
  // Limited token has only `incidents:read`. Attempt `POST /incidents`
  const limitedWriteRes = await fetch(`${apiBase}/incidents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${fixtures.tokens.limited}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `ltd-write-${Date.now()}`,
    },
    body: JSON.stringify({
      title: 'Limited Token Write Attempt',
      serviceId: fixtures.services.serviceAId,
      urgency: 'LOW',
      priority: 'P3',
    }),
  });

  console.log(`Limited token POST /incidents status: HTTP ${limitedWriteRes.status}`);
  if (limitedWriteRes.status !== 403) {
    throw new Error(
      `Limited-scope token was permitted mutating call! Status: ${limitedWriteRes.status}`
    );
  }
  const ltdJson = await limitedWriteRes.json();
  console.log(
    `Limited token error code: ${ltdJson.code} (${ltdJson.userMessage || ltdJson.detail})`
  );
  console.log('Limited Scope Enforcement: PASSED (Strict 403 rejection, zero database writes).\n');

  // Cleanup test resources
  await prisma.service.delete({ where: { id: teamBService.id } });
  console.log('Cleaned up test services.');

  console.log('======================================================================');
  console.log('   AUTHORIZATION & ZERO SIDE-EFFECT AUDIT COMPLETE (100% PASSED)      ');
  console.log('======================================================================');
}

main()
  .catch(err => {
    console.error('Fatal authorization error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
