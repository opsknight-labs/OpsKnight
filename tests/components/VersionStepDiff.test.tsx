import { describe, it, expect } from 'vitest';
import { getRiskTone } from '@/components/runbooks/detail/VersionStepDiff';

describe('VersionStepDiff risk tone indicators', () => {
  it('assigns sky tone for READ_ONLY risk', () => {
    const tone = getRiskTone('READ_ONLY');
    expect(tone).toContain('sky-500');
  });

  it('assigns amber tone for IDEMPOTENT_WRITE risk', () => {
    const tone = getRiskTone('IDEMPOTENT_WRITE');
    expect(tone).toContain('amber-500');
  });

  it('assigns rose tone for NON_IDEMPOTENT risk', () => {
    const tone = getRiskTone('NON_IDEMPOTENT');
    expect(tone).toContain('rose-500');
  });

  it('preserves aliases REVERSIBLE_CHANGE and IRREVERSIBLE_ACTION', () => {
    expect(getRiskTone('REVERSIBLE_CHANGE')).toContain('amber-500');
    expect(getRiskTone('IRREVERSIBLE_ACTION')).toContain('rose-500');
  });

  it('falls back to muted tone for null, undefined, or unrecognized risk', () => {
    expect(getRiskTone(null)).toContain('muted');
    expect(getRiskTone(undefined)).toContain('muted');
    expect(getRiskTone('UNKNOWN_RISK')).toContain('muted');
  });
});
