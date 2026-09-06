import { describe, expect, it } from 'vitest';
import { APP_VERSION as VERSION_FROM_LIB } from '@/lib/version';
import { APP_VERSION as VERSION_FROM_CONSTANTS } from '@/lib/constants';
import packageJson from '../../package.json';

describe('Application Version Resolution (Single Source of Truth)', () => {
  it('correctly resolves version.ts to package.json version', () => {
    expect(VERSION_FROM_LIB).toBe(packageJson.version);
  });

  it('correctly resolves constants.ts to v-prefixed package.json version', () => {
    expect(VERSION_FROM_CONSTANTS).toBe(`v${packageJson.version}`);
  });

  it('matches semantic versioning format', () => {
    expect(VERSION_FROM_LIB).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION_FROM_CONSTANTS).toMatch(/^v\d+\.\d+\.\d+/);
  });
});
