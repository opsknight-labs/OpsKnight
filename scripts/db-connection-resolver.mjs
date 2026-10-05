import resolver from './db-connection-resolver.cjs';

export const {
  cleanDatabaseUrl,
  readSecretFile,
  parseDotenvFile,
  describeDatabaseTarget,
  resolveDatabaseUrl,
  getDatabaseDiagnostics,
  WELL_KNOWN_SECRET_PATHS,
  WELL_KNOWN_DIRECT_SECRET_PATHS,
  WELL_KNOWN_POSTGRES_PASSWORD_PATHS,
} = resolver;

export default resolver;
