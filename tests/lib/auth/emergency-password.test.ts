// @vitest-environment node
import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generateEmergencyPassword,
  verifyEmergencyPassword,
} from '@/lib/auth-control/emergency-password';
describe('bounded emergency password hashing', () => {
  it('generates independent random secrets with salted scrypt and rejects incorrect/unknown hashes', async () => {
    const startedAt = performance.now();
    const first = await generateEmergencyPassword();
    const second = await generateEmergencyPassword();
    expect(first.password).not.toBe(second.password);
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyEmergencyPassword(first.password, first.hash)).toBe(true);
    expect(await verifyEmergencyPassword(second.password, first.hash)).toBe(false);
    expect(await verifyEmergencyPassword(first.password, null)).toBe(false);
    mkdirSync('plans/certification', { recursive: true });
    writeFileSync(
      'plans/certification/enterprise-sso-2.1-password-hashing.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          scope:
            'Local Node crypto scrypt via actual recovery password helper; not a production throughput certificate',
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          openssl: process.versions.openssl,
          algorithm: 'scrypt',
          N: 32768,
          r: 8,
          p: 3,
          generatedPasswordBits: 256,
          saltBits: 128,
          operations: 5,
          totalDurationMs: performance.now() - startedAt,
          maximumConcurrentOperationsPerProcess: 6,
          laneLimits: { unknown: 1, login: 2, reauthentication: 1, management: 2 },
          unknownAccountKdfExercised: true,
        },
        null,
        2
      ) + '\n'
    );
  });
  it('preserves real login and authenticated reauthentication while unknown work is saturated', async () => {
    const credential = await generateEmergencyPassword();
    const unknown = verifyEmergencyPassword('attacker-input', null);
    const flood = Promise.allSettled(
      Array.from({ length: 40 }, () => verifyEmergencyPassword('attacker-input', null))
    );
    const login = verifyEmergencyPassword(credential.password, credential.hash, {
      identity: 'custodian-one',
      reauthentication: false,
    });
    const duplicate = verifyEmergencyPassword('wrong', credential.hash, {
      identity: 'custodian-one',
      reauthentication: false,
    }).catch(() => 'busy');
    const reauth = verifyEmergencyPassword(credential.password, credential.hash, {
      identity: 'custodian-one',
      reauthentication: true,
    });
    expect(await login).toBe(true);
    expect(await reauth).toBe(true);
    expect(await duplicate).toBe('busy');
    expect(await unknown).toBe(false);
    expect((await flood).every(result => result.status === 'rejected')).toBe(true);
    expect(
      await verifyEmergencyPassword(credential.password, credential.hash, {
        identity: 'custodian-one',
        reauthentication: false,
      })
    ).toBe(true);
  });
  it('one targeted known identity cannot spend the other login slot or reauthentication capacity', async () => {
    const credential = await generateEmergencyPassword();
    const targeted = verifyEmergencyPassword('wrong', credential.hash, {
      identity: 'targeted-custodian',
      reauthentication: false,
    });
    const repeated = Promise.allSettled(
      Array.from({ length: 20 }, () =>
        verifyEmergencyPassword('wrong', credential.hash, {
          identity: 'targeted-custodian',
          reauthentication: false,
        })
      )
    );
    const legitimate = verifyEmergencyPassword(credential.password, credential.hash, {
      identity: 'other-custodian',
      reauthentication: false,
    });
    const reauth = verifyEmergencyPassword(credential.password, credential.hash, {
      identity: 'targeted-custodian',
      reauthentication: true,
    });
    expect(await legitimate).toBe(true);
    expect(await reauth).toBe(true);
    expect(await targeted).toBe(false);
    expect((await repeated).every(result => result.status === 'rejected')).toBe(true);
  });
  it('bounds concurrent memory-hard work without an unbounded request queue', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 3 }, () => generateEmergencyPassword())
    );
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(2);
    expect(outcomes.filter(value => value.status === 'rejected')).toHaveLength(1);
  });
});
