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
  '/var/run/secrets/direct_database_url',
  '/var/run/secrets/opsknight_web_database_url',
];

const WELL_KNOWN_DIRECT_SECRET_PATHS = [
  '/run/secrets/opsknight_direct_database_url',
  '/run/secrets/direct_database_url',
  '/var/run/secrets/opsknight_direct_database_url',
  '/var/run/secrets/direct_database_url',
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
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1).trim();
  }
  return val.length > 0 ? val : null;
}

/**
 * Safely reads a secret file from disk. Removes trailing line endings while preserving password bytes.
 * Returns null if the file does not exist, is not a regular file, is empty, or cannot be read.
 * @param {string|undefined|null} filePath
 * @param {{ existsSync: (path: string) => boolean, statSync: (path: string) => { isFile: () => boolean }, readFileSync: (path: string, encoding: 'utf8') => string }} [fsModule]
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
        return raw.replace(/[\r\n]+$/g, '') || null;
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
    const result = Object.create(null);
    for (const line of lines) {
      const trimmed = line.trim().replace(/^export\s+/, '');
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      const quoted = val.match(/^(['"])(.*?)\1(?:\s*#.*)?$/);
      val = quoted ? quoted[2] : val.split('#', 1)[0].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) result[key] = val;
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
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) return null;
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
 * @param {boolean} [options.allowFallbackToLocalDotenv] (default: false in production) Inspect local .env files if not found in env/secrets
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
    }
    return url;
  }

  function validateUrl(raw, source) {
    const url = cleanDatabaseUrl(raw);
    if (!url) return null;
    if (!describeDatabaseTarget(url) || /[\r\n]/.test(url)) {
      throw new Error(`${source} must contain a valid PostgreSQL connection URL.`);
    }
    return url;
  }

  function configuredUrl(name) {
    const pointer = env[`${name}_FILE`];
    if (pointer && pointer.trim()) {
      const value = readSecretFile(pointer, fsModule);
      if (!value || !cleanDatabaseUrl(value)) {
        throw new Error(`${name}_FILE must reference a readable, non-empty secret file.`);
      }
      return validateUrl(value, `${name}_FILE`);
    }
    return validateUrl(env[name], name);
  }

  // Keep each explicit URL and its _FILE variant together. Direct connections
  // must win over pooled files for session-level locks and schema management.
  const names = preferDirect
    ? ['DIRECT_DATABASE_URL', 'DATABASE_URL', 'WEB_DATABASE_URL', 'OPSKNIGHT_DATABASE_URL']
    : ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'WEB_DATABASE_URL', 'OPSKNIGHT_DATABASE_URL'];
  for (const name of names) {
    const url = configuredUrl(name);
    if (url) return finalize(url);
  }

  // Explicit configuration always wins over inferred mount locations.
  const secretPaths = preferDirect
    ? [...new Set([...WELL_KNOWN_DIRECT_SECRET_PATHS, ...WELL_KNOWN_SECRET_PATHS])]
    : WELL_KNOWN_SECRET_PATHS;
  for (const secretPath of secretPaths) {
    const value = readSecretFile(secretPath, fsModule);
    if (value) return finalize(validateUrl(value, 'Mounted database secret'));
  }

  // 4. Bundled PostgreSQL credentials synthesis (if explicit password exists)
  let postgresPass = env.POSTGRES_PASSWORD;
  if (env.POSTGRES_PASSWORD_FILE?.trim()) {
    postgresPass = readSecretFile(env.POSTGRES_PASSWORD_FILE, fsModule);
    if (!postgresPass) {
      throw new Error('POSTGRES_PASSWORD_FILE must reference a readable, non-empty secret file.');
    }
  }
  postgresPass ||= WELL_KNOWN_POSTGRES_PASSWORD_PATHS.map(p => readSecretFile(p, fsModule)).find(
    Boolean
  );

  if (postgresPass) {
    const user = env.POSTGRES_USER || 'opsknight';
    let host = env.POSTGRES_HOST || env.DATABASE_HOST || 'opsknight-db';
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;
    const port = env.POSTGRES_PORT || env.DATABASE_PORT || '5432';
    const db = env.POSTGRES_DB || env.DATABASE_NAME || 'opsknight_db';
    const sslmode = env.POSTGRES_SSLMODE || 'prefer';
    const synthesized = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(postgresPass)}@${host}:${port}/${encodeURIComponent(db)}?sslmode=${encodeURIComponent(sslmode)}`;
    return finalize(validateUrl(synthesized, 'PostgreSQL credentials'));
  }

  // Never pick up a bundled/stale development database in production by default.
  const allowDotenv = options.allowFallbackToLocalDotenv ?? env.NODE_ENV !== 'production';
  if (allowDotenv) {
    const mode = ['development', 'test', 'production'].includes(env.NODE_ENV)
      ? env.NODE_ENV
      : 'development';
    const filenames = [
      `.env.${mode}.local`,
      ...(mode === 'test' ? [] : ['.env.local']),
      `.env.${mode}`,
      '.env',
    ];
    const parsed = Object.create(null);
    const roots = [...new Set([process.cwd(), path.resolve(__dirname, '..')])];
    for (const root of roots) {
      for (const filename of filenames) {
        const values = parseDotenvFile(path.join(root, filename), fsModule);
        for (const [key, value] of Object.entries(values || {})) {
          if (parsed[key] === undefined) parsed[key] = value;
        }
      }
    }
    if (Object.keys(parsed).length) {
      return finalize(
        resolveDatabaseUrl({
          ...options,
          env: { ...parsed, ...env },
          allowFallbackToLocalDotenv: false,
          applyToEnv: false,
        })
      );
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
      } catch {
        status = 'inaccessible';
      }
      lines.push(`    - ${varName}: configured -> ${status}`);
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
