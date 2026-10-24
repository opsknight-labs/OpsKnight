/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS fixture bootstrap registers the shared TypeScript runtime. */
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !database.pathname.startsWith('/ingestion_test')
) {
  throw new Error('Ingestion harness requires isolated localhost ingestion_test database');
}
// Host diagnostics always use the validated disposable datasource, including
// when the invoking shell happens to carry the web runtime role. Container
// PgBouncer URLs are configured independently by the Docker topology harness.
process.env.WEB_DATABASE_URL = database.toString();
require('ts-node').register({ project: 'tsconfig.script.json', transpileOnly: true });
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: {
    '@/*': ['src/*'],
    'server-only': ['tests/mocks/server-only.ts'],
  },
});
