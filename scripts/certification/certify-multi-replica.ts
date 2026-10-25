import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { API_SCOPES } from '../../src/lib/authorization';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`[FATAL] Missing mandatory environment variable: ${name}. Configure it in .env or shell environment.`);
  }
  return value.trim();
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const API_KEY_SECRET = requireEnv('API_KEY_SECRET');

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } }
});

function hashToken(token: string): string {
  return createHmac('sha256', API_KEY_SECRET)
    .update(`opsknight:api-key:v2:${token}`)
    .digest('hex');
}

async function mintDedicatedKey(name: string) {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  const raw = randomBytes(24).toString('base64url');
  const token = `ok_mr_${raw}`;
  const prefix = token.slice(0, 15);
  const tokenHash = hashToken(token);

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      tokenHash,
      prefix,
      userId: admin!.id,
      scopes: Object.values(API_SCOPES)
    }
  });

  return { token, apiKey };
}

async function main() {
  console.log('======================================================================');
  console.log('   MULTI-REPLICA (2x & 4x) DISTRIBUTED TOPOLOGY CERTIFICATION        ');
  console.log('======================================================================\n');

  const proxyBase = 'http://127.0.0.1:3900/api/v2';
  const fixtures = JSON.parse(fs.readFileSync('tests/certification/fixtures.json', 'utf8'));

  // -------------------------------------------------------------------------
  // TEST 1: Two-Replica Topology Baseline & Health
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Two-Replica Topology Active Health Verification ---');
  // Ensure 2 replicas running
  execSync('docker compose --project-name opsknight-cert-v2 --env-file tests/certification/.env -f tests/certification/docker-compose.release-cert.yml up -d --scale web=2', { stdio: 'inherit' });
  execSync('docker exec opsknight-cert-v2-proxy-1 nginx -s reload');
  await new Promise(r => setTimeout(r, 2000));

  const healthRes = await fetch('http://127.0.0.1:3900/api/health?mode=readiness');
  console.log(`Reverse proxy readiness probe: HTTP ${healthRes.status}`);
  if (healthRes.status !== 200) throw new Error('Proxy readiness failed');

  console.log('Verifying traffic distribution across distinct backends...');
  const servedBy = new Map<string, number>();
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${proxyBase}/teams`, {
      headers: { 'Authorization': `Bearer ${fixtures.tokens.admin}` }
    });
    const backend = res.headers.get('x-served-by') || 'unknown';
    servedBy.set(backend, (servedBy.get(backend) || 0) + 1);
  }
  console.log('Two-Replica Traffic Distribution (X-Served-By):', Object.fromEntries(servedBy.entries()));
  if (servedBy.size < 2) {
    throw new Error(`Traffic reached only ${servedBy.size} backend(s). Expected at least 2 distinct replicas.`);
  }
  console.log('Multi-Replica Distribution Verified: Traffic successfully load-balanced across distinct pods.');

  // -------------------------------------------------------------------------
  // TEST 2: Cross-Replica Immediate Token Revocation
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Cross-Replica Immediate Token Revocation ---');
  const testKey = await mintDedicatedKey('Multi-Replica Revocation Key');
  console.log(`Minted active token: ${testKey.token.slice(0, 16)}...`);

  // Warm across replicas with 10 requests
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${proxyBase}/incidents`, {
      headers: { 'Authorization': `Bearer ${testKey.token}` }
    });
    if (res.status !== 200) throw new Error(`Initial token warm failed: ${res.status}`);
  }
  console.log('Warmed token across multi-replica pool: 10/10 HTTP 200.');

  // Revoke in PostgreSQL
  console.log('Revoking token directly in shared database...');
  await prisma.apiKey.update({
    where: { id: testKey.apiKey.id },
    data: { revokedAt: new Date() }
  });

  // Immediately make 20 requests across replicas through reverse proxy
  console.log('Sending 20 immediate requests through reverse proxy...');
  const postRevocationResults = await Promise.all(
    Array.from({ length: 20 }).map(async () => {
      const res = await fetch(`${proxyBase}/incidents`, {
        headers: { 'Authorization': `Bearer ${testKey.token}` }
      });
      return res.status;
    })
  );

  const revoked401 = postRevocationResults.filter(s => s === 401).length;
  console.log(`Post-revocation responses: 401=${revoked401} / 20 (${((revoked401/20)*100).toFixed(1)}%)`);
  if (revoked401 !== 20) {
    throw new Error(`Stale token allowed after revocation! Received non-401s: ${postRevocationResults.filter(s => s !== 401)}`);
  }
  console.log('Immediate Cross-Replica Revocation: PASSED (Zero stale cache window across all nodes).');

  // -------------------------------------------------------------------------
  // TEST 3: Cross-Replica Idempotency Key Consistency
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: Cross-Replica Idempotency Key Replication ---');
  const idempotencyKey = `idemp-multi-${Date.now()}-${randomBytes(8).toString('hex')}`;
  const incidentPayload = {
    title: `Multi-Replica Idempotent Incident ${Date.now()}`,
    description: 'Testing distributed idempotency storage across replicas',
    serviceId: fixtures.services.serviceAId,
    urgency: 'HIGH',
    priority: 'P2'
  };

  // First POST creates the resource
  const firstPost = await fetch(`${proxyBase}/incidents`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fixtures.tokens.admin}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(incidentPayload)
  });
  const firstJson = await firstPost.json();
  const createdIncidentId = firstJson.data.id;
  console.log(`Initial POST created incident ID: ${createdIncidentId} (HTTP ${firstPost.status})`);

  // Now replay 15 times concurrently across replicas with the same key
  console.log('Replaying identical request 15 times concurrently across load-balanced replicas...');
  const replayResults = await Promise.all(
    Array.from({ length: 15 }).map(async () => {
      const res = await fetch(`${proxyBase}/incidents`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fixtures.tokens.admin}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify(incidentPayload)
      });
      const json = await res.json();
      return { status: res.status, id: json?.data?.id };
    })
  );

  const matchedIdCount = replayResults.filter(r => r.id === createdIncidentId).length;
  console.log(`Replays returning identical incident ID: ${matchedIdCount} / 15`);
  if (matchedIdCount !== 15) {
    throw new Error(`Idempotency divergence detected across replicas!`);
  }

  // Verify in PostgreSQL that exactly ONE incident was created
  const incidentCount = await prisma.incident.count({
    where: { title: incidentPayload.title }
  });
  console.log(`PostgreSQL record count for title: ${incidentCount} (Expected: exactly 1)`);
  if (incidentCount !== 1) {
    throw new Error(`Duplicate records created in database! Count: ${incidentCount}`);
  }
  console.log('Cross-Replica Idempotency: PASSED (Exact-once creation verified).');

  // -------------------------------------------------------------------------
  // TEST 4: Cross-Replica Concurrent Writes with ETag Preconditions (If-Match)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Cross-Replica Concurrency & Precondition Locking (If-Match) ---');
  // Create test team
  const teamRes = await fetch(`${proxyBase}/teams`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fixtures.tokens.admin}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: `Concurrent Team ${Date.now()}` })
  });
  const teamJson = await teamRes.json();
  const testTeamId = teamJson.data.id;
  
  // Fetch initial ETag from detail GET endpoint
  const getTeamRes = await fetch(`${proxyBase}/teams/${testTeamId}`, {
    headers: { 'Authorization': `Bearer ${fixtures.tokens.admin}` }
  });
  const initialEtag = getTeamRes.headers.get('etag');
  console.log(`Created test team ${testTeamId} with ETag: ${initialEtag}`);

  // Send two racing PATCH requests with the SAME ETag to different replicas via proxy
  console.log('Dispatching racing PATCH requests with identical ETag...');
  const racePatch1 = fetch(`${proxyBase}/teams/${testTeamId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${fixtures.tokens.admin}`,
      'Content-Type': 'application/json',
      'If-Match': initialEtag!
    },
    body: JSON.stringify({ description: 'Update from Client A' })
  });

  const racePatch2 = fetch(`${proxyBase}/teams/${testTeamId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${fixtures.tokens.admin}`,
      'Content-Type': 'application/json',
      'If-Match': initialEtag!
    },
    body: JSON.stringify({ description: 'Update from Client B' })
  });

  const [resA, resB] = await Promise.all([racePatch1, racePatch2]);
  const statuses = [resA.status, resB.status].sort();
  console.log(`Racing update outcomes: ${resA.status} and ${resB.status}`);
  if (statuses[0] !== 200 || statuses[1] !== 412) {
    throw new Error(`ETag race assertion failed: expected [200, 412], received [${statuses.join(', ')}]`);
  }
  console.log('ETag Precondition Protection: PASSED (Strictly exactly 1 write succeeded with 200, exactly 1 rejected with 412 Precondition Failed).');

  // -------------------------------------------------------------------------
  // TEST 5: Four-Replica Topology Scaling & Chaos Termination Failover
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Four-Replica Scaling & Node Termination Mid-Flight ---');
  console.log('Scaling web tier to 4 production replicas...');
  execSync('docker compose --project-name opsknight-cert-v2 --env-file tests/certification/.env -f tests/certification/docker-compose.release-cert.yml up -d --scale web=4', { stdio: 'inherit' });
  execSync('docker exec opsknight-cert-v2-proxy-1 nginx -s reload');
  await new Promise(r => setTimeout(r, 4000));

  // Verify all 4 containers healthy
  const psOutput = execSync('docker ps --filter "name=opsknight-cert-v2-web" --format "{{.Names}}: {{.Status}}"').toString();
  console.log('Active web containers:\n' + psOutput.trim());

  console.log('Verifying traffic distribution across all 4 distinct backends...');
  const servedBy4 = new Map<string, number>();
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${proxyBase}/teams`, {
      headers: { 'Authorization': `Bearer ${fixtures.tokens.admin}` }
    });
    const backend = res.headers.get('x-served-by') || 'unknown';
    servedBy4.set(backend, (servedBy4.get(backend) || 0) + 1);
  }
  console.log('Four-Replica Traffic Distribution (X-Served-By):', Object.fromEntries(servedBy4.entries()));
  if (servedBy4.size < 4) {
    throw new Error(`Traffic reached only ${servedBy4.size} backend(s) in 4-replica topology. Expected all 4 distinct replicas.`);
  }
  console.log('Four-Replica Distribution Verified: Traffic successfully reached all 4 distinct replicas.');

  // Launch sustained 40-request burst across all 4 replicas while killing container #4
  console.log('Dispatching 40 in-flight requests while terminating replica web-4...');
  let killTriggered = false;
  const chaosRequests = Promise.all(
    Array.from({ length: 40 }).map(async (_, idx) => {
      if (idx === 10 && !killTriggered) {
        killTriggered = true;
        try {
          execSync('docker stop opsknight-cert-v2-web-4', { stdio: 'ignore' });
          console.log('>> [CHAOS] Stopped opsknight-cert-v2-web-4 during active requests.');
        } catch {}
      }
      try {
        const res = await fetch(`${proxyBase}/incidents`, {
          headers: { 'Authorization': `Bearer ${fixtures.tokens.admin}` }
        });
        return res.status;
      } catch (err: any) {
        return 0;
      }
    })
  );

  const chaosStatuses = await chaosRequests;
  const chaos200 = chaosStatuses.filter(s => s === 200).length;
  const chaosErrors = chaosStatuses.filter(s => s !== 200).length;
  console.log(`Chaos in-flight failover results:`);
  console.log(`  Successful requests (HTTP 200): ${chaos200} / 40 (${((chaos200/40)*100).toFixed(1)}%)`);
  console.log(`  Failed requests (5xx / network errors): ${chaosErrors} / 40`);
  if (chaos200 !== 40) {
    throw new Error(`Failover dropped requests during replica termination! Non-200s: ${chaosStatuses.filter(s => s !== 200)}`);
  }
  console.log('Node Termination & Reverse Proxy Failover: PASSED (100% Zero-Loss High Availability).');

  // Recover replica web-4
  console.log('Recovering replica web-4 and restoring 4-replica topology...');
  execSync('docker compose --project-name opsknight-cert-v2 --env-file tests/certification/.env -f tests/certification/docker-compose.release-cert.yml up -d --scale web=4', { stdio: 'inherit' });
  execSync('docker exec opsknight-cert-v2-proxy-1 nginx -s reload');

  // Scale back to 2 stable replicas
  execSync('docker compose --project-name opsknight-cert-v2 --env-file tests/certification/.env -f tests/certification/docker-compose.release-cert.yml up -d --scale web=2', { stdio: 'inherit' });
  execSync('docker exec opsknight-cert-v2-proxy-1 nginx -s reload');

  console.log('\n======================================================================');
  console.log('   MULTI-REPLICA TOPOLOGY CERTIFICATION COMPLETE (100% PASSED)       ');
  console.log('======================================================================');
}

main()
  .catch(err => {
    console.error('Fatal multi-replica error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
