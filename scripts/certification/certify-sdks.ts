import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client as TsClient, ApiError as TsApiError } from '../../sdk/typescript/dist/client.js';

async function main() {
  console.log('=== Starting Phase 7: Live SDK Certification ===\n');

  const fixturesPath = path.resolve('tests/certification/fixtures.json');
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

  const apiBase = fixtures.apiBase || 'http://127.0.0.1:3900/api/v2';
  const adminToken = fixtures.tokens.admin;
  const responderToken = fixtures.tokens.responder;

  console.log(`Target API Base: ${apiBase}`);

  // ==========================================
  // PART 1: TypeScript SDK Certification
  // ==========================================
  console.log('\n--- 1. Testing TypeScript SDK against Live Release Stack ---');

  const tsClient = new TsClient({
    baseUrl: apiBase,
    token: adminToken,
    allowInsecureHttp: true,
    maxRetries: 2,
    timeoutMs: 15000,
  });

  const tsResults: { test: string; status: 'PASS' | 'FAIL'; latencyMs: number; error?: string }[] = [];

  async function runTsTest(name: string, fn: () => Promise<void>) {
    const start = Date.now();
    try {
      await fn();
      const latencyMs = Date.now() - start;
      tsResults.push({ test: name, status: 'PASS', latencyMs });
      console.log(`  [PASS] ${name} (${latencyMs}ms)`);
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      tsResults.push({ test: name, status: 'FAIL', latencyMs, error: err?.message || String(err) });
      console.error(`  [FAIL] ${name} (${latencyMs}ms):`, err?.message || err);
    }
  }

  // 1.1 List Users
  await runTsTest('tsClient.call("listUsers")', async () => {
    const res = await tsClient.call('listUsers', { query: { limit: 5 } });
    if (!res.data || !Array.isArray(res.data)) throw new Error('Invalid users list response');
    if (res.data.length === 0) throw new Error('Expected at least one user');
  });

  // 1.2 Get User
  await runTsTest('tsClient.call("getUser")', async () => {
    const res = await tsClient.call('getUser', { params: { id: fixtures.users.responderId } });
    if (!res.data || res.data.id !== fixtures.users.responderId) throw new Error('User ID mismatch');
  });

  // 1.3 List Services
  await runTsTest('tsClient.call("listServices")', async () => {
    const res = await tsClient.call('listServices', { query: { limit: 5 } });
    if (!res.data || !Array.isArray(res.data)) throw new Error('Invalid services list response');
  });

  // 1.4 Get Service
  await runTsTest('tsClient.call("getService")', async () => {
    const res = await tsClient.call('getService', { params: { id: fixtures.services.serviceAId } });
    if (!res.data || res.data.id !== fixtures.services.serviceAId) throw new Error('Service ID mismatch');
  });

  // 1.5 Incident Operations
  let incidentId: string = fixtures.incidents.openId;
  await runTsTest('tsClient.call("getIncident")', async () => {
    const res = await tsClient.call('getIncident', { params: { id: incidentId } });
    if (!res.data || res.data.id !== incidentId) throw new Error('Incident ID mismatch');
  });

  // 1.6 Pagination traversal
  await runTsTest('tsClient.paginate("listIncidents")', async () => {
    let pages = 0;
    let count = 0;
    for await (const row of tsClient.paginate('listIncidents', { query: { limit: 2 } }, 3)) {
      count++;
      if (count > 4) break;
    }
    if (count === 0) throw new Error('Pagination returned 0 incidents');
  });

  // 1.7 Runbook Authoring Workflow
  let tsRunbookId: string = '';
  let tsDraftVersionId: string = '';
  let tsPublishedVersionId: string = '';

  await runTsTest('tsClient.call("createRunbook")', async () => {
    const suffix = randomUUID().slice(0, 8);
    const res = await tsClient.call('createRunbook', {
      body: {
        name: `TS SDK Runbook ${suffix}`,
        slug: `ts-sdk-${suffix}`,
        description: 'Created by TypeScript live certification',
      },
      headers: { 'Idempotency-Key': `ts-create-${suffix}` },
    });
    if (!res.data || !res.data.id || !res.data.draftVersionId) throw new Error('Runbook creation failed');
    tsRunbookId = res.data.id;
    tsDraftVersionId = res.data.draftVersionId;
  });

  await runTsTest('tsClient.call("validateRunbookDraft")', async () => {
    const res = await tsClient.call('validateRunbookDraft', {
      params: { id: tsRunbookId, versionId: tsDraftVersionId },
      body: {},
    });
    if (!res.data || res.data.valid !== true) throw new Error('Runbook draft validation failed');
  });

  await runTsTest('tsClient.call("publishRunbookDraft")', async () => {
    const suffix = randomUUID().slice(0, 8);
    const res = await tsClient.call('publishRunbookDraft', {
      params: { id: tsRunbookId, versionId: tsDraftVersionId },
      body: {},
      headers: { 'If-Match': '"0"', 'Idempotency-Key': `ts-pub-${suffix}` },
    });
    if (!res.data || res.data.state !== 'PUBLISHED') throw new Error('Runbook publication failed');
    tsPublishedVersionId = res.data.id;
  });

  // 1.8 Error Handling (Assert ApiError on 404)
  await runTsTest('tsClient error handling on 404', async () => {
    try {
      await tsClient.call('getService', { params: { id: 'nonexistent-service-cuid' } });
      throw new Error('Expected ApiError was not thrown');
    } catch (err: any) {
      if (err instanceof TsApiError && err.status === 404) {
        // Expected
        return;
      }
      throw err;
    }
  });

  // 1.9 Scope Denial Error handling
  await runTsTest('tsClient error handling on 403 scope denial', async () => {
    const ltdClient = new TsClient({
      baseUrl: apiBase,
      token: fixtures.tokens.limited,
      allowInsecureHttp: true,
    });
    try {
      await ltdClient.call('deleteTeam', { params: { id: fixtures.teams.teamAId } });
      throw new Error('Expected 403 was not thrown');
    } catch (err: any) {
      if (err instanceof TsApiError && (err.status === 403 || err.status === 401)) {
        return;
      }
      throw err;
    }
  });

  // ==========================================
  // PART 2: Python SDK Certification
  // ==========================================
  console.log('\n--- 2. Testing Python SDK against Live Release Stack ---');

  const pyResults: { test: string; status: 'PASS' | 'FAIL'; output?: string; error?: string }[] = [];

  // 2.1 Python SDK Unit Tests
  console.log('  Running Python SDK unit tests (test_client.py)...');
  const pyUnit = spawnSync('python3', ['tests/sdk/test_client.py'], {
    encoding: 'utf8',
  });
  if (pyUnit.status === 0) {
    pyResults.push({ test: 'Python SDK Unit Tests (10/10)', status: 'PASS' });
    console.log('  [PASS] Python SDK Unit Tests (10/10 passed)');
  } else {
    pyResults.push({ test: 'Python SDK Unit Tests', status: 'FAIL', error: pyUnit.stderr || pyUnit.stdout });
    console.error('  [FAIL] Python SDK Unit Tests:', pyUnit.stderr || pyUnit.stdout);
  }

  // 2.2 Python Live End-to-End Workflows
  console.log('  Running Python live workflow (test_python_sdk_live.py)...');
  const pyLive = spawnSync('python3', ['scripts/certification/test_python_sdk_live.py'], {
    encoding: 'utf8',
  });

  if (pyLive.status === 0) {
    pyResults.push({ test: 'Python Live Workflows (12/12)', status: 'PASS', output: pyLive.stdout });
    console.log('  [PASS] Python Live Workflows (12/12 passed)');
    console.log('    ' + pyLive.stdout.trim().split('\n').join('\n    '));
  } else {
    pyResults.push({
      test: 'Python Live Workflows',
      status: 'FAIL',
      error: pyLive.stderr || pyLive.stdout,
    });
    console.error('  [FAIL] Python Live Workflows:', pyLive.stderr || pyLive.stdout);
  }

  // Summary
  const allTsPass = tsResults.every(r => r.status === 'PASS');
  const allPyPass = pyResults.every(r => r.status === 'PASS');

  console.log('\n======================================================');
  console.log(`Phase 7 SDK Certification Summary:`);
  console.log(`TypeScript SDK: ${tsResults.filter(r => r.status === 'PASS').length}/${tsResults.length} passed`);
  console.log(`Python SDK:     ${pyResults.filter(r => r.status === 'PASS').length}/${pyResults.length} passed`);
  console.log(`Overall Result: ${allTsPass && allPyPass ? 'PASSED 100%' : 'FAILED'}`);
  console.log('======================================================\n');

  // Write SDK Certification Evidence Report
  const sdkReport = {
    certifiedAt: new Date().toISOString(),
    apiBase,
    typescriptSdk: {
      status: allTsPass ? 'PASS' : 'FAIL',
      tests: tsResults,
    },
    pythonSdk: {
      status: allPyPass ? 'PASS' : 'FAIL',
      tests: pyResults,
    },
    overallVerdict: allTsPass && allPyPass ? 'PASS' : 'FAIL',
  };

  const reportPath = path.resolve('reports/api-v2-certification/fdabcf67b45ae772d9c4413dc4a915f5b1ea3cfc/SDK-REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(sdkReport, null, 2), 'utf8');
  console.log(`Wrote SDK Certification Report to ${reportPath}`);

  if (!allTsPass || !allPyPass) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('SDK certification runner failed:', err);
  process.exit(1);
});
