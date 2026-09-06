import { APP_VERSION as BASE_APP_VERSION } from './version';

/**
 * Application-wide constants
 * Automatically derives the application version from package.json via version.ts
 */
export const APP_VERSION = BASE_APP_VERSION.startsWith('v')
  ? BASE_APP_VERSION
  : `v${BASE_APP_VERSION}`;
