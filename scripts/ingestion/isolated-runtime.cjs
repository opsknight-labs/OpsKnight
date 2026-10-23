const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (
  !['localhost', '127.0.0.1'].includes(database.hostname) ||
  !database.pathname.startsWith('/ingestion_test')
) {
  throw new Error('Ingestion harness requires isolated localhost ingestion_test database');
}
require('ts-node').register({ project: 'tsconfig.script.json', transpileOnly: true });
require('tsconfig-paths').register({
  baseUrl: process.cwd(),
  paths: {
    '@/*': ['src/*'],
    'server-only': ['tests/mocks/server-only.ts'],
  },
});
