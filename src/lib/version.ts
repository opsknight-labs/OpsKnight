import packageJson from '../../package.json';

/**
 * Application Version Constant
 * Resolves the application version dynamically from environment or package.json.
 */
export const APP_VERSION: string =
  process.env.APP_VERSION ||
  process.env.NEXT_PUBLIC_APP_VERSION ||
  process.env.npm_package_version ||
  packageJson.version ||
  '1.3.0';

/**
 * Immutable deployment identity shared by every replica serving the same build.
 *
 * Never use a process-start identifier for client deployment detection: in an HA
 * deployment that makes ordinary load balancing look like a rollout. Operators
 * can set OPSKNIGHT_DEPLOYMENT_ID explicitly; common platform commit/image
 * identifiers are consumed automatically. APP_VERSION is the safe final fallback
 * (it may miss same-version redeploys, but it cannot cause false reloads between pods).
 */
export const DEPLOYMENT_ID: string =
  process.env.OPSKNIGHT_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.GIT_COMMIT_SHA ||
  process.env.SOURCE_VERSION ||
  process.env.RENDER_GIT_COMMIT ||
  process.env.IMAGE_DIGEST ||
  APP_VERSION;
