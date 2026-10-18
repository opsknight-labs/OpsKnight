const {
  CDPDriver,
} = require('/Users/dushyantrahangdale/.gemini/antigravity/brain/2fbfa638-d94e-4c8c-be04-a130a7942642/scratch/cdp_driver.js');
import fs from 'node:fs';
import path from 'node:path';

interface VerifiedExecution {
  testId: string;
  executionId: string;
  url: string;
  status: number;
  ok: boolean;
  pageTitle?: string;
}

const CERTIFIED_EXECUTIONS = [
  {
    testId: 'AUTO-001',
    executionId: 'cmvdpapw42taf4qmq7moudh12',
    description: 'Automated Docker Recovery',
  },
  {
    testId: 'AUTO-002',
    executionId: 'cmvdsgt9s31if4qmqbx6mcms6',
    description: 'Direct Docker Host Recovery',
  },
  {
    testId: 'AUTO-003',
    executionId: 'cmvdpgtum2trk4qmqcsw4jbzr',
    description: 'Kubernetes Scale & Rollout Recovery',
  },
  {
    testId: 'AUTO-004',
    executionId: 'cmvdqqbdu2wyi4qmq7podn4f1',
    description: 'Linux Native Systemd Recovery',
  },
  {
    testId: 'AUTO-005',
    executionId: 'cmvdpp7jv2ue94qmq9sxnqlrc',
    description: 'Rootless Podman Recovery',
  },
  {
    testId: 'AUTO-006',
    executionId: 'cmvdshjja31lb4qmqza231w10',
    description: 'Docker Swarm Replica Recovery',
  },
  {
    testId: 'AUTO-007',
    executionId: 'cmvchadqm09584qmqassxvp0s',
    description: 'Blast Radius Human Approval Gate',
  },
  {
    testId: 'AUTO-008',
    executionId: 'cmvcf0z5k03gj4qmqyxd9v63s',
    description: 'Alert Deduplication',
  },
  {
    testId: 'HA-001',
    executionId: 'cmvdr7xco2ydw4qmqxxp0jizv',
    description: 'Shared-Target Live Failover',
  },
];

async function main() {
  console.log('--- Verifying Live Execution Backing on Staging (https://opssentinal.com) ---');
  const cdp = new CDPDriver();
  await cdp.connect();

  const results: VerifiedExecution[] = [];

  for (const item of CERTIFIED_EXECUTIONS) {
    const route = `/runbooks/executions/${item.executionId}`;
    const check = await cdp.eval(`(() => {
      return fetch('${route}').then(r => ({ status: r.status, ok: r.ok })).catch(e => ({ error: e.message }));
    })()`);

    console.log(
      `[${check.ok ? 'PASS' : 'FAIL'}] ${item.testId} (${item.description}) -> ${route} (HTTP ${check.status})`
    );
    results.push({
      testId: item.testId,
      executionId: item.executionId,
      url: `https://opssentinal.com${route}`,
      status: check.status,
      ok: check.ok,
    });
  }

  cdp.close();

  const allPassed = results.every(r => r.ok && r.status === 200);
  console.log('\nVerification Summary:');
  console.log(`Total live executions verified: ${results.length}`);
  console.log(`All backed by live HTTP 200 staging records: ${allPassed}`);

  const outPath = path.resolve(
    process.cwd(),
    'plans/runbook-engine/enterprise-physical-certification/results/LIVE-STAGING-VERIFICATION.json'
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      { verifiedAt: new Date().toISOString(), allPassed, executions: results },
      null,
      2
    ),
    'utf-8'
  );
  console.log('Saved live verification receipt to:', outPath);

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Verification error:', err);
  process.exit(1);
});
