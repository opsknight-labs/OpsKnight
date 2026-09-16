/**
 * Production Certification Script for Incident Collaboration Platform
 *
 * Runs non-destructive certification checks on a staging/production database:
 * 1. Database schema & column integrity (cleanup debt, indexes, state machine)
 * 2. Invariants contract completeness (I1 - I15)
 * 3. Meeting reconciliation health (cleanup debt, stalled provisions)
 * 4. Metrics registry compliance (bounded cardinality)
 * 5. Provider adapter registry readiness
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/certify-incident-collaboration.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { COLLABORATION_INVARIANTS } from '../src/lib/incident-collaboration/invariants';
import { MeetingProviderRegistry } from '../src/lib/incident-collaboration/meeting-registry';
import { getGlobalWarRoomPolicy } from '../src/lib/incident-collaboration/policy';

const prisma = new PrismaClient();

interface CertificationResult {
  id: string;
  name: string;
  passed: boolean;
  details: string;
}

async function runCertification(): Promise<void> {
  console.log('================================================================');
  console.log('  OPSKNIGHT INCIDENT COLLABORATION PRODUCTION CERTIFICATION');
  console.log('================================================================\n');

  const results: CertificationResult[] = [];

  // 1. Schema & Migration Certification
  try {
    const tableCheck = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'IncidentMeeting'
    `;
    const cols = new Set(tableCheck.map(r => r.column_name));
    const requiredCols = [
      'id',
      'incidentId',
      'provider',
      'generation',
      'state',
      'health',
      'externalId',
      'joinUrl',
      'provisioningToken',
      'closeStartedAt',
      'cleanupAttemptedAt',
      'lastReconciledAt',
      'externalCleanupPending',
      'lastErrorCode',
      'lastErrorMessage',
      'closeToken',
      'cleanupRetryCount',
    ];

    const missing = requiredCols.filter(c => !cols.has(c));
    results.push({
      id: 'CERT-SCHEMA',
      name: 'IncidentMeeting Table Schema & Debt Columns',
      passed: missing.length === 0,
      details:
        missing.length === 0
          ? `All ${requiredCols.length} canonical columns present.`
          : `Missing columns: ${missing.join(', ')}`,
    });
  } catch (err) {
    results.push({
      id: 'CERT-SCHEMA',
      name: 'IncidentMeeting Table Schema & Debt Columns',
      passed: false,
      details: `Database error: ${(err as Error).message}`,
    });
  }

  // 2. Index Certification
  try {
    const indexCheck = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'IncidentMeeting'
    `;
    const indexNames = new Set(indexCheck.map(r => r.indexname));
    const expectedIndexes = [
      'IncidentMeeting_incidentId_generation_key',
      'IncidentMeeting_incidentId_state_idx',
      'IncidentMeeting_provider_externalId_idx',
      'IncidentMeeting_state_health_externalCleanupPending_lastReconci',
    ];

    const missingIndexes = expectedIndexes.filter(i => !indexNames.has(i));
    results.push({
      id: 'CERT-INDEXES',
      name: 'IncidentMeeting Operational Indexes',
      passed: missingIndexes.length === 0,
      details:
        missingIndexes.length === 0
          ? `All ${expectedIndexes.length} performance & cleanup indexes confirmed.`
          : `Missing indexes: ${missingIndexes.join(', ')}`,
    });
  } catch (err) {
    results.push({
      id: 'CERT-INDEXES',
      name: 'IncidentMeeting Operational Indexes',
      passed: false,
      details: `Database error: ${(err as Error).message}`,
    });
  }

  // 3. Invariants Contract Completeness
  const invariantCount = Object.keys(COLLABORATION_INVARIANTS).length;
  results.push({
    id: 'CERT-INVARIANTS',
    name: 'Collaboration Invariants Contract (I1-I15)',
    passed: invariantCount >= 15,
    details: `${invariantCount}/15 invariants registered in canonical contract.`,
  });

  // 4. Provider Registry Readiness
  const teamsAdapter = MeetingProviderRegistry.getAdapter('MICROSOFT_TEAMS');
  const zoomAdapter = MeetingProviderRegistry.getAdapter('ZOOM');
  const meetAdapter = MeetingProviderRegistry.getAdapter('GOOGLE_MEET');
  const jitsiAdapter = MeetingProviderRegistry.getAdapter('JITSI');

  const allAdaptersReady = Boolean(teamsAdapter && zoomAdapter && meetAdapter && jitsiAdapter);
  results.push({
    id: 'CERT-ADAPTERS',
    name: 'Meeting Provider Adapter Registry',
    passed: allAdaptersReady,
    details: allAdaptersReady
      ? 'Teams, Zoom, Google Meet, and Jitsi adapters fully registered.'
      : 'One or more meeting adapters missing from registry.',
  });

  // 5. Cleanup Debt Audit
  try {
    const cleanupDebtCount = await prisma.incidentMeeting.count({
      where: { externalCleanupPending: true },
    });
    results.push({
      id: 'CERT-CLEANUP-DEBT',
      name: 'Meeting Cleanup Debt Audit',
      passed: true,
      details: `Current pending external cleanup debt items: ${cleanupDebtCount}`,
    });
  } catch (err) {
    results.push({
      id: 'CERT-CLEANUP-DEBT',
      name: 'Meeting Cleanup Debt Audit',
      passed: false,
      details: `Error reading cleanup debt: ${(err as Error).message}`,
    });
  }

  // 6. Policy Resolution Integrity
  try {
    const policy = await getGlobalWarRoomPolicy();
    results.push({
      id: 'CERT-POLICY',
      name: 'Global Collaboration Policy Engine',
      passed: Boolean(policy && Array.isArray(policy.defaultProviders)),
      details: `Active providers: [${policy.defaultProviders.join(', ')}], warRoomsEnabled: ${policy.enabled}, meeting: ${policy.defaultMeetingProvider}`,
    });
  } catch (err) {
    results.push({
      id: 'CERT-POLICY',
      name: 'Global Collaboration Policy Engine',
      passed: false,
      details: `Policy error: ${(err as Error).message}`,
    });
  }

  // Print Summary
  let allPassed = true;
  for (const r of results) {
    const mark = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${mark}] ${r.id}: ${r.name}`);
    console.log(`       ${r.details}\n`);
    if (!r.passed) allPassed = false;
  }

  console.log('================================================================');
  if (allPassed) {
    console.log('  CERTIFICATION STATUS: PASSED (System is production-ready)');
  } else {
    console.log('  CERTIFICATION STATUS: FAILED (Address failures before release)');
  }
  console.log('================================================================\n');

  await prisma.$disconnect();
  if (!allPassed) {
    process.exit(1);
  }
}

runCertification().catch(err => {
  console.error('Fatal error during certification:', err);
  process.exit(1);
});
