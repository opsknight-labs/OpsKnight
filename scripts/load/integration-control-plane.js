import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';

const baseUrl = (__ENV.BASE_URL || 'http://host.docker.internal:3300').replace(/\/$/, '');
export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 100),
      timeUnit: '1s',
      duration: __ENV.DURATION || '2m',
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    checks: ['rate>0.99'],
  },
};
export default function () {
  const payload = JSON.stringify({
    action: 'completed',
    repository: {
      name: 'OpsKnight',
      full_name: 'opsknight-labs/OpsKnight',
      html_url: 'https://github.com/opsknight-labs/OpsKnight',
    },
    workflow_run: {
      id: 539,
      name: 'Certification',
      head_branch: 'main',
      status: 'completed',
      conclusion: 'failure',
      html_url: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/539',
    },
  });
  const response = http.post(
    `${baseUrl}/api/integrations/github?integrationId=cert-github`,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Integration-Key': 'certification-integration-key',
        'X-GitHub-Delivery': `retry-storm-${__ITER % 25}`,
        'X-Hub-Signature-256': `sha256=${crypto.hmac(
          'sha256',
          'certification-signing-secret',
          payload,
          'hex'
        )}`,
      },
      tags: { plane: 'integration', provider: 'github' },
    }
  );
  check(response, {
    'integration accepted or duplicate': value => value.status === 202 || value.status === 200,
  });
  sleep(0.01);
}
