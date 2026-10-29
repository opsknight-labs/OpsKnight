import { check, sleep } from 'k6';
import http from 'k6/http';
import {
  getActiveLoadLevel,
  getBaseUrl,
  getDurationProfile,
  loadSeedManifest,
  opsknightMetrics,
} from './_shared.js';

const manifest = loadSeedManifest();
const level = getActiveLoadLevel();
const durations = getDurationProfile();

export const options = {
  scenarios: {
    security_sanity_probes: {
      executor: 'constant-arrival-rate',
      rate: Math.max(5, Math.floor(level.targetRps * 0.1)),
      timeUnit: '1s',
      duration: durations.steady,
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'runSecuritySanityUnderLoad',
    },
  },
  thresholds: {
    opsknight_security_check_success_rate: ['rate>0.98'],
  },
};

export function runSecuritySanityUnderLoad() {
  const baseUrl = getBaseUrl();
  const probeType = (__ITER + __VU) % 4;
  let res;

  if (probeType === 0) {
    // Probe 1: Completely invalid API token must return 401
    res = http.get(`${baseUrl}/api/incidents`, {
      headers: { Authorization: 'Bearer forged_token_000000000000000000000000' },
      tags: { endpoint: 'sec_probe_bad_token' },
    });
    const ok = check(res, {
      'forged token rejected with 401': r => r.status === 401,
    });
    opsknightMetrics.securityCheckSuccessRate.add(ok);
  } else if (probeType === 1) {
    // Probe 2: Malformed JSON body must return 400
    res = http.post(
      `${baseUrl}/api/events`,
      '{"event_action": "trigger", "unclosed_json: true',
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token token=${manifest.contractIntegrationKey}`,
        },
        tags: { endpoint: 'sec_probe_malformed_json' },
      }
    );
    const ok = check(res, {
      'malformed JSON rejected with 400': r => r.status === 400,
    });
    opsknightMetrics.securityCheckSuccessRate.add(ok);
  } else if (probeType === 2) {
    // Probe 3: Oversized payload (> 2MB)
    const largeSummary = 'A'.repeat(1024 * 1024 * 2);
    res = http.post(
      `${baseUrl}/api/events`,
      JSON.stringify({
        event_action: 'trigger',
        dedup_key: `lt-sec-oversized-${__VU}-${__ITER}`,
        payload: { summary: largeSummary },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token token=${manifest.contractIntegrationKey}`,
        },
        tags: { endpoint: 'sec_probe_oversized' },
      }
    );
    const ok = check(res, {
      'oversized payload rejected with 400 or 413': r =>
        r.status === 400 || r.status === 413 || r.status === 429,
    });
    opsknightMetrics.securityCheckSuccessRate.add(ok);
  } else {
    // Probe 4: SSRF Loopback probe to internal metadata service
    res = http.post(
      `${baseUrl}/api/integrations/webhook/test`,
      JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${manifest.adminApiKey}`,
        },
        tags: { endpoint: 'sec_probe_ssrf' },
      }
    );
    const ok = check(res, {
      'SSRF loopback rejected with 400, 403, or 422': r =>
        r.status === 400 || r.status === 403 || r.status === 404 || r.status === 422 || r.status === 429,
    });
    opsknightMetrics.securityCheckSuccessRate.add(ok);
  }

  sleep(0.1);
}
