import packageJson from '../../package.json';

/**
 * Application Version Constant
 * Resolves the application version dynamically from environment or package.json
 */
export const APP_VERSION: string =
  process.env.APP_VERSION ||
  process.env.NEXT_PUBLIC_APP_VERSION ||
  process.env.npm_package_version ||
  packageJson.version ||
  '1.3.0';
