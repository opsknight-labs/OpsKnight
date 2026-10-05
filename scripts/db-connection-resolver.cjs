'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WELL_KNOWN_SECRET_PATHS = [
  '/run/secrets/opsknight_database_url',
  '/run/secrets/opsknight_direct_database_url',
  '/run/secrets/opsknight_web_database_url',
  '/run/secrets/database_url',
  '/run/secrets/direct_database_url',
  '/var/run/secrets/opsknight_database_url',
  '/var/run/secrets/opsknight_direct_database_url',
  '/var/run/secrets/database_url',
];

const WELL_KNOWN_DIRECT_SECRET_PATHS = [
  '/run/secrets/opsknight_direct_database_url',
  '/run/secrets/direct_database_url',
  '/var/run/secrets/opsknight_direct_database_url',
];

const WELL_KNOWN_POSTGRES_PASSWORD_PATHS = [
  '/run/secrets/opsknight_postgres_password',
  '/run/secrets/postgres_password',
  '/var/run/secrets/opsknight_postgres_password',
  '/var/run/secrets/postgres_password',
];

/**
 * Strips enclosing quotes and extraneous whitespace from a connection URL string.
 */
function cleanDatabaseUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let val = raw.trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  return val.length > 0 ? val : null;
}

/**
 * Safely reads a secret file from disk. Strips carriage returns and newlines.
 * Returns null if the file does not exist, is not a regular file, is empty, or cannot be read.
 */
function readSecretFile(filePath, fsModule = fs) {
  if (!filePath || typeof filePath !== 'string') return null;
  const cleanPath = filePath.trim();
  if (!cleanPath) return null;
  try {
    if (fsModule.existsSync(cleanPath)) {
      const stat = fsModule.statSync(cleanPath);
      if (stat.isFile()) {
        const raw = fsModule.readFileSync(cleanPath, 'utf8');
        const stripped = raw.replace(/[\r\n]+/g, '').trim();
        return cleanDatabaseUrl(stripped);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Parses simple KEY=VALUE definitions from a .env file.
 */
function parseDotenvFile(filePath, fsModule = fs) {
  if (!filePath || typeof filePath !== 'string') return null;
  try {
    if (!fsModule.existsSync(filePath)) return null;
    const stat = fsModule.statSync(filePath);
    if (!stat.isFile()) return null;
    const content = fsModule.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    const result = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Safely extracts host:port from a database URL without leaking credentials.
 */
function describeDatabaseTarget(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    const port = url.port || '5432';
    return `${url.hostname}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Resolves a database connection URL across environment variables, secret files,
 * standard container mount points, bundled postgres credentials, and local dotenv files.
 *
 * @param {Object} [options]
 * @param {boolean} [options.preferDirect=false] Prefer direct (unpooled) connections over pooled
 * @param {boolean} [options.applyToEnv=true] Automatically assign resolved URL to process.env.DATABASE_URL
 * @param {boolean} [options.allowFallbackToLocalDotenv=true] Inspect local .env files if not found in env/secrets
 * @param {Object} [options.env] Override environment dictionary (defaults to process.env)
 * @param {Object} [options.fs] Override fs module for testing
 * @returns {string|null} Resolved database connection URL, or null if unresolved
 */
function resolveDatabaseUrl(options = {}) {
  const env = options.env || process.env;
  const fsModule = options.fs || fs;
  const preferDirect = Boolean(options.preferDirect);
  const applyToEnv = options.applyToEnv !== false;

  function finalize(url) {
    if (!url) return null;
    if (applyToEnv && options.env === undefined) {
      process.env.DATABASE_URL = url;
      if (!process.env.DIRECT_DATABASE_URL) {
        process.env.DIRECT_DATABASE_URL = url;
      }
    }
    return url;
  }

  // 1. Secret file pointers specified via environment variables (_FILE convention)
  if (preferDirect) {
    const directFile = readSecretFile(env.DIRECT_DATABASE_URL_FILE, fsModule);
    if (directFile) return finalize(directFile);
  }

  const dbFile = readSecretFile(env.DATABASE_URL_FILE, fsModule);
  if (dbFile) return finalize(dbFile);

  if (!preferDirect) {
    const directFile = readSecretFile(env.DIRECT_DATABASE_URL_FILE, fsModule);
    if (directFile) return finalize(directFile);
  }

  const webFile =
    readSecretFile(env.WEB_DATABASE_URL_FILE, fsModule) ||
    readSecretFile(env.OPSKNIGHT_DATABASE_URL_FILE, fsModule);
  if (webFile) return finalize(webFile);

  // 2. Direct environment variables
  if (preferDirect) {
    const directEnv = cleanDatabaseUrl(env.DIRECT_DATABASE_URL);
    if (directEnv) return finalize(directEnv);
  }

  const direct = cleanDatabaseUrl(env.DATABASE_URL);
  if (direct) return finalize(direct);

  if (!preferDirect) {
    const directAlt = cleanDatabaseUrl(env.DIRECT_DATABASE_URL);
    if (directAlt) return finalize(directAlt);
  }

  const webEnv =
    cleanDatabaseUrl(env.WEB_DATABASE_URL) ||
    cleanDatabaseUrl(env.OPSKNIGHT_DATABASE_URL);
  if (webEnv) return finalize(webEnv);

  // 3. Known container secret mount points (Docker Swarm / Kubernetes)
  if (preferDirect) {
    for (const secretPath of WELL_KNOWN_DIRECT_SECRET_PATHS) {
      const val = readSecretFile(secretPath, fsModule);
      if (val) return finalize(val);
    }
  }

  for (const secretPath of WELL_KNOWN_SECRET_PATHS) {
    const val = readSecretFile(secretPath, fsModule);
    if (val) return finalize(val);
  }

  // 4. Bundled PostgreSQL credentials synthesis (if explicit password exists)
  const postgresPass =
    cleanDatabaseUrl(env.POSTGRES_PASSWORD) ||
    readSecretFile(env.POSTGRES_PASSWORD_FILE, fsModule) ||
    WELL_KNOWN_POSTGRES_PASSWORD_PATHS.map(p => readSecretFile(p, fsModule)).find(Boolean);

  if (postgresPass) {
    const user = env.POSTGRES_USER || 'opsknight';
    const host = env.POSTGRES_HOST || env.DATABASE_HOST || 'opsknight-db';
    const port = env.POSTGRES_PORT || env.DATABASE_PORT || '5432';
    const db = env.POSTGRES_DB || env.DATABASE_NAME || 'opsknight_db';
    const sslmode = env.POSTGRES_SSLMODE || 'prefer';
    const synthesized = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(postgresPass)}@${host}:${port}/${encodeURIComponent(db)}?sslmode=${sslmode}`;
    return finalize(synthesized);
  }

  // 5. Local dotenv files (development / bare-metal fallback)
  if (options.allowFallbackToLocalDotenv !== false) {
    const candidates = [
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), '.env.production'),
      path.resolve(process.cwd(), '.env.local'),
      path.resolve(__dirname, '..', '.env'),
      path.resolve(__dirname, '..', '.env.production'),
      path.resolve(__dirname, '..', '.env.local'),
    ];

    const visited = new Set();
    for (const dotenvPath of candidates) {
      if (visited.has(dotenvPath)) continue;
      visited.add(dotenvPath);
      const parsed = parseDotenvFile(dotenvPath, fsModule);
      if (parsed) {
        if (preferDirect && cleanDatabaseUrl(parsed.DIRECT_DATABASE_URL)) {
          return finalize(cleanDatabaseUrl(parsed.DIRECT_DATABASE_URL));
        }
        if (cleanDatabaseUrl(parsed.DATABASE_URL)) {
          return finalize(cleanDatabaseUrl(parsed.DATABASE_URL));
        }
        if (cleanDatabaseUrl(parsed.DIRECT_DATABASE_URL)) {
          return finalize(cleanDatabaseUrl(parsed.DIRECT_DATABASE_URL));
        }
      }
    }
  }

  return null;
}

/**
 * Returns human-readable diagnostic details describing the examined configuration
 * sources without exposing sensitive credentials.
 */
function getDatabaseDiagnostics(options = {}) {
  const env = options.env || process.env;
  const fsModule = options.fs || fs;

  const lines = ['Database connection diagnostics:'];

  lines.push('  Environment variables:');
  for (const varName of [
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'WEB_DATABASE_URL',
    'OPSKNIGHT_DATABASE_URL',
  ]) {
    const val = env[varName];
    lines.push(`    - ${varName}: ${val ? `set (${val.length} chars)` : 'not set'}`);
  }

  lines.push('  Secret file environment variables:');
  for (const varName of [
    'DATABASE_URL_FILE',
    'DIRECT_DATABASE_URL_FILE',
    'WEB_DATABASE_URL_FILE',
    'OPSKNIGHT_DATABASE_URL_FILE',
  ]) {
    const filePath = env[varName];
    if (!filePath) {
      lines.push(`    - ${varName}: not set`);
    } else {
      let status = 'not found';
      try {
        if (fsModule.existsSync(filePath)) {
          const stat = fsModule.statSync(filePath);
          status = stat.isFile()
            ? stat.size > 0
              ? `found (${stat.size} bytes)`
              : 'found (empty file)'
            : 'not a regular file';
        }
      } catch (err) {
        status = `inaccessible (${err.code || 'error'})`;
      }
      lines.push(`    - ${varName}: "${filePath}" -> ${status}`);
    }
  }

  lines.push('  Standard container secret mount paths:');
  for (const secretPath of [
    '/run/secrets/opsknight_database_url',
    '/run/secrets/opsknight_direct_database_url',
    '/run/secrets/opsknight_web_database_url',
    '/run/secrets/database_url',
  ]) {
    let status = 'not found';
    try {
      if (fsModule.existsSync(secretPath)) {
        const stat = fsModule.statSync(secretPath);
        status = stat.isFile()
          ? stat.size > 0
            ? `found (${stat.size} bytes)`
            : 'found (empty file)'
          : 'not a regular file';
      }
    } catch {
      status = 'not accessible';
    }
    lines.push(`    - ${secretPath}: ${status}`);
  }

  return lines.join('\n');
}

module.exports = {
  cleanDatabaseUrl,
  readSecretFile,
  parseDotenvFile,
  describeDatabaseTarget,
  resolveDatabaseUrl,
  getDatabaseDiagnostics,
  WELL_KNOWN_SECRET_PATHS,
  WELL_KNOWN_DIRECT_SECRET_PATHS,
  WELL_KNOWN_POSTGRES_PASSWORD_PATHS,
};
