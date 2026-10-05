import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import {
  cleanDatabaseUrl,
  describeDatabaseTarget,
  getDatabaseDiagnostics,
  readSecretFile,
  resolveDatabaseUrl,
} from '../../scripts/db-connection-resolver.cjs';

describe('db-connection-resolver', () => {
  describe('cleanDatabaseUrl', () => {
    it('trims whitespace and strips surrounding double quotes', () => {
      expect(cleanDatabaseUrl('  "postgresql://user:pass@localhost:5432/db"  ')).toBe(
        'postgresql://user:pass@localhost:5432/db'
      );
    });

    it('trims whitespace and strips surrounding single quotes', () => {
      expect(cleanDatabaseUrl("  'postgresql://user:pass@localhost:5432/db'  ")).toBe(
        'postgresql://user:pass@localhost:5432/db'
      );
    });

    it('returns null for null, undefined, empty, or whitespace-only inputs', () => {
      expect(cleanDatabaseUrl(null)).toBeNull();
      expect(cleanDatabaseUrl(undefined)).toBeNull();
      expect(cleanDatabaseUrl('')).toBeNull();
      expect(cleanDatabaseUrl('   ')).toBeNull();
      expect(cleanDatabaseUrl('""')).toBeNull();
    });
  });

  describe('describeDatabaseTarget', () => {
    it('extracts host and port without exposing user or password', () => {
      const target = describeDatabaseTarget(
        'postgresql://admin:super_secret_pw@db.corp.internal:5433/prod_db'
      );
      expect(target).toBe('db.corp.internal:5433');
      expect(target).not.toContain('super_secret_pw');
      expect(target).not.toContain('admin');
    });

    it('defaults to port 5432 if port is omitted', () => {
      expect(describeDatabaseTarget('postgresql://user:pass@db.local/opsknight')).toBe(
        'db.local:5432'
      );
    });

    it('returns null for invalid or empty URLs', () => {
      expect(describeDatabaseTarget('')).toBeNull();
      expect(describeDatabaseTarget('not-a-url')).toBeNull();
      expect(describeDatabaseTarget(undefined)).toBeNull();
    });
  });

  describe('readSecretFile', () => {
    it('reads a secret file, strips CRLF, and returns cleaned content', () => {
      const mockFs = {
        existsSync: (p: string) => p === '/run/secrets/my_secret',
        statSync: () => ({ isFile: () => true, size: 40 }),
        readFileSync: () => 'postgresql://user:secret@host:5432/db\r\n',
      };
      const result = readSecretFile('/run/secrets/my_secret', mockFs);
      expect(result).toBe('postgresql://user:secret@host:5432/db');
    });

    it('returns null if file does not exist or is not a regular file', () => {
      const mockFs = {
        existsSync: () => false,
        statSync: () => ({ isFile: () => false }),
        readFileSync: () => '',
      };
      expect(readSecretFile('/nonexistent', mockFs)).toBeNull();
    });
  });

  describe('resolveDatabaseUrl', () => {
    it('returns DATABASE_URL directly if set in environment', () => {
      const mockEnv = {
        DATABASE_URL: 'postgresql://env-user:env-pass@host:5432/main',
      };
      const result = resolveDatabaseUrl({
        env: mockEnv,
        applyToEnv: false,
        allowFallbackToLocalDotenv: false,
      });
      expect(result).toBe('postgresql://env-user:env-pass@host:5432/main');
    });

    it('resolves from DATABASE_URL_FILE when DATABASE_URL is unset (Docker Swarm)', () => {
      const mockEnv = {
        DATABASE_URL_FILE: '/run/secrets/opsknight_database_url',
      };
      const mockFs = {
        existsSync: (p: string) => p === '/run/secrets/opsknight_database_url',
        statSync: () => ({ isFile: () => true, size: 50 }),
        readFileSync: () => 'postgresql://swarm-user:swarm-pass@swarm-db:5432/opsknight\n',
      };
      const result = resolveDatabaseUrl({
        env: mockEnv,
        fs: mockFs,
        applyToEnv: false,
        allowFallbackToLocalDotenv: false,
      });
      expect(result).toBe('postgresql://swarm-user:swarm-pass@swarm-db:5432/opsknight');
    });

    it('resolves from well-known container mount path when neither DATABASE_URL nor _FILE is set', () => {
      const mockEnv = {};
      const mockFs = {
        existsSync: (p: string) => p === '/run/secrets/opsknight_database_url',
        statSync: () => ({ isFile: () => true, size: 50 }),
        readFileSync: () => 'postgresql://direct-mount:pass@host:5432/mount_db',
      };
      const result = resolveDatabaseUrl({
        env: mockEnv,
        fs: mockFs,
        applyToEnv: false,
        allowFallbackToLocalDotenv: false,
      });
      expect(result).toBe('postgresql://direct-mount:pass@host:5432/mount_db');
    });

    it('prefers DIRECT_DATABASE_URL_FILE over pooled connection when preferDirect is true', () => {
      const mockEnv = {
        DATABASE_URL_FILE: '/run/secrets/opsknight_database_url',
        DIRECT_DATABASE_URL_FILE: '/run/secrets/opsknight_direct_database_url',
      };
      const mockFs = {
        existsSync: () => true,
        statSync: () => ({ isFile: () => true, size: 50 }),
        readFileSync: (p: string) =>
          p.includes('direct')
            ? 'postgresql://direct:pass@db:5432/direct_db'
            : 'postgresql://pooled:pass@pgbouncer:6432/pool_db',
      };
      const result = resolveDatabaseUrl({
        env: mockEnv,
        fs: mockFs,
        preferDirect: true,
        applyToEnv: false,
        allowFallbackToLocalDotenv: false,
      });
      expect(result).toBe('postgresql://direct:pass@db:5432/direct_db');
    });

    it('synthesizes connection string when raw POSTGRES_PASSWORD credentials exist', () => {
      const mockEnv = {
        POSTGRES_USER: 'custom_admin',
        POSTGRES_PASSWORD: 'custom@password!',
        POSTGRES_HOST: 'postgres.internal',
        POSTGRES_PORT: '5433',
        POSTGRES_DB: 'custom_db',
      };
      const mockFs = {
        existsSync: () => false,
      };
      const result = resolveDatabaseUrl({
        env: mockEnv,
        fs: mockFs,
        applyToEnv: false,
        allowFallbackToLocalDotenv: false,
      });
      expect(result).toBe(
        'postgresql://custom_admin:custom%40password!@postgres.internal:5433/custom_db?sslmode=prefer'
      );
    });

    it('returns null when no database configuration can be found', () => {
      const mockEnv = {};
      const mockFs = {
        existsSync: () => false,
      };
      const result = resolveDatabaseUrl({
        env: mockEnv,
        fs: mockFs,
        applyToEnv: false,
        allowFallbackToLocalDotenv: false,
      });
      expect(result).toBeNull();
    });
  });

  describe('getDatabaseDiagnostics', () => {
    it('produces diagnostic text without leaking sensitive credentials or passwords', () => {
      const mockEnv = {
        DATABASE_URL_FILE: '/run/secrets/opsknight_database_url',
      };
      const mockFs = {
        existsSync: (p: string) => p === '/run/secrets/opsknight_database_url',
        statSync: () => ({ isFile: () => true, size: 45 }),
      };
      const diagnostics = getDatabaseDiagnostics({ env: mockEnv, fs: mockFs });
      expect(diagnostics).toContain('Database connection diagnostics:');
      expect(diagnostics).toContain('DATABASE_URL: not set');
      expect(diagnostics).toContain('DATABASE_URL_FILE: configured -> found (45 bytes)');
      expect(diagnostics).not.toContain('password');
      expect(diagnostics).not.toContain('super_secret_pw');
    });
  });
});

const pooledUrl = 'postgresql://pool:secret@pool:6432/db?pgbouncer=true';
const directUrl = 'postgresql://admin:secret@db:5432/db';
const emptyFs = { existsSync: () => false };
function secretFs(files: Record<string, string>) {
  return {
    existsSync: (p: string) => Object.hasOwn(files, p),
    statSync: () => ({ isFile: () => true, size: 100 }),
    // eslint-disable-next-line security/detect-object-injection -- Fixed in-memory test fixtures.
    readFileSync: (p: string) => files[p],
  };
}

describe('database configuration precedence and failure handling', () => {
  it('prefers a direct environment URL over a pooled secret pointer', () => {
    expect(
      resolveDatabaseUrl({
        env: { DATABASE_URL_FILE: '/pool', DIRECT_DATABASE_URL: directUrl },
        fs: secretFs({ '/pool': pooledUrl }),
        preferDirect: true,
      })
    ).toBe(directUrl);
  });

  it('prefers the runtime environment URL over a fallback direct secret pointer', () => {
    expect(
      resolveDatabaseUrl({
        env: { DATABASE_URL: pooledUrl, DIRECT_DATABASE_URL_FILE: '/direct' },
        fs: secretFs({ '/direct': directUrl }),
      })
    ).toBe(pooledUrl);
  });

  it('uses a file over the matching ambient variable, as the entrypoint does', () => {
    expect(
      resolveDatabaseUrl({
        env: { DATABASE_URL: pooledUrl, DATABASE_URL_FILE: '/db' },
        fs: secretFs({ '/db': directUrl + '\r\n' }),
      })
    ).toBe(directUrl);
  });

  it.each(['WEB_DATABASE_URL', 'OPSKNIGHT_DATABASE_URL', 'DIRECT_DATABASE_URL'])(
    'supports %s as an environment fallback',
    name => {
      expect(resolveDatabaseUrl({ env: { [name]: directUrl }, fs: emptyFs })).toBe(directUrl);
      expect(
        resolveDatabaseUrl({
          env: { [`${name}_FILE`]: '/db' },
          fs: secretFs({ '/db': directUrl }),
        })
      ).toBe(directUrl);
    }
  );

  it('keeps explicit external configuration ahead of automatic mount discovery and synthesis', () => {
    expect(
      resolveDatabaseUrl({
        env: { DATABASE_URL: directUrl, POSTGRES_PASSWORD: 'local-password' },
        fs: secretFs({ '/run/secrets/opsknight_database_url': pooledUrl }),
        preferDirect: true,
      })
    ).toBe(directUrl);
  });

  it('prefers the direct conventional mount over the pooled mount', () => {
    expect(
      resolveDatabaseUrl({
        env: {},
        preferDirect: true,
        fs: secretFs({
          '/run/secrets/opsknight_database_url': pooledUrl,
          '/var/run/secrets/direct_database_url': directUrl,
        }),
      })
    ).toBe(directUrl);
  });

  it.each([
    'DATABASE_URL',
    'DIRECT_DATABASE_URL',
    'WEB_DATABASE_URL',
    'OPSKNIGHT_DATABASE_URL',
    'POSTGRES_PASSWORD',
  ])('rejects a missing explicitly configured %s_FILE rather than guessing a database', name => {
    expect(() =>
      resolveDatabaseUrl({
        env: { [`${name}_FILE`]: '/missing' },
        fs: secretFs({ '/run/secrets/opsknight_database_url': '' }),
      })
    ).toThrow(`${name}_FILE must reference a readable, non-empty secret file.`);
  });

  it.each(['', '\r\n', '   '])('rejects empty database secret content (%j)', content => {
    expect(() =>
      resolveDatabaseUrl({
        env: { DATABASE_URL_FILE: '/db', DATABASE_URL: directUrl },
        fs: secretFs({ '/db': content }),
      })
    ).toThrow('DATABASE_URL_FILE');
  });

  it.each([
    'https://user:secret@host/db',
    'secret-invalid-url',
    'postgresql:///db',
    'postgresql://user:secret@host/\ndb',
  ])('rejects invalid URLs without printing their contents (%j)', value => {
    let message = '';
    try {
      resolveDatabaseUrl({ env: { DATABASE_URL: value }, fs: emptyFs });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe('DATABASE_URL must contain a valid PostgreSQL connection URL.');
    expect(message).not.toContain('secret');
  });

  it('preserves quotes, spaces and reserved characters in raw passwords', () => {
    const password = ' "secret:@/#?%" ';
    const url = resolveDatabaseUrl({ env: { POSTGRES_PASSWORD: password }, fs: emptyFs });
    expect(decodeURIComponent(new URL(url!).password)).toBe(password);
    expect(
      resolveDatabaseUrl({
        env: { POSTGRES_PASSWORD_FILE: '/password' },
        fs: secretFs({ '/password': password + '\r\n' }),
      })
    ).toBe(url);
  });

  it('brackets IPv6 hosts and encodes synthesized URL components', () => {
    const url = new URL(
      resolveDatabaseUrl({
        env: {
          POSTGRES_HOST: '::1',
          POSTGRES_PASSWORD: 'secret',
          POSTGRES_DB: 'ops/name',
          POSTGRES_SSLMODE: 'require&other=x',
        },
        fs: emptyFs,
      })!
    );
    expect(url.hostname).toBe('[::1]');
    expect(url.pathname).toBe('/ops%2Fname');
    expect(url.searchParams.get('sslmode')).toBe('require&other=x');
    expect(url.searchParams.has('other')).toBe(false);
  });

  it('never prints file pointers or filesystem error details in diagnostics', () => {
    const diagnostics = getDatabaseDiagnostics({
      env: { DATABASE_URL: directUrl, DATABASE_URL_FILE: 'postgresql://secret-in-pointer@host/db' },
      fs: {
        existsSync: () => {
          throw new Error('secret-error');
        },
      },
    });
    expect(diagnostics).toContain('configured -> inaccessible');
    expect(diagnostics).not.toContain('secret-in-pointer');
    expect(diagnostics).not.toContain('secret-error');
    expect(diagnostics).not.toContain(directUrl);
  });
});

describe('dotenv fallback', () => {
  const localFile = path.resolve('.env.local');
  const envFile = path.resolve('.env');
  const fs = secretFs({
    [localFile]: `export DATABASE_URL="${directUrl}" # operator override`,
    [envFile]: `DATABASE_URL=${pooledUrl}`,
  });

  it('loads local overrides ahead of base .env and understands export and inline comments', () => {
    expect(resolveDatabaseUrl({ env: { NODE_ENV: 'development' }, fs })).toBe(directUrl);
  });

  it('does not load local dotenv files in production unless explicitly enabled', () => {
    expect(resolveDatabaseUrl({ env: { NODE_ENV: 'production' }, fs })).toBeNull();
    expect(
      resolveDatabaseUrl({ env: { NODE_ENV: 'production' }, fs, allowFallbackToLocalDotenv: true })
    ).toBe(directUrl);
  });

  it('honors disabled dotenv fallback', () => {
    expect(resolveDatabaseUrl({ env: {}, fs, allowFallbackToLocalDotenv: false })).toBeNull();
  });

  it('does not let dotenv override explicit environment configuration', () => {
    expect(resolveDatabaseUrl({ env: { DATABASE_URL: pooledUrl }, fs })).toBe(pooledUrl);
  });

  it('supports secret pointers and direct URLs from dotenv configuration', () => {
    expect(
      resolveDatabaseUrl({
        env: { NODE_ENV: 'development' },
        preferDirect: true,
        fs: secretFs({
          [envFile]: `DATABASE_URL=${pooledUrl}\nDIRECT_DATABASE_URL_FILE=/direct`,
          '/direct': directUrl,
        }),
      })
    ).toBe(directUrl);
  });

  it('preserves literal # in quoted values', () => {
    expect(
      resolveDatabaseUrl({
        env: {},
        fs: secretFs({ [envFile]: 'POSTGRES_PASSWORD="secret#123" # comment' }),
      })
    ).toContain('secret%23123');
  });
});

describe('environment side effects', () => {
  afterEach(() => vi.unstubAllEnvs());

  function clearDatabaseEnv() {
    for (const name of [
      'DATABASE_URL',
      'DIRECT_DATABASE_URL',
      'WEB_DATABASE_URL',
      'OPSKNIGHT_DATABASE_URL',
      'POSTGRES_PASSWORD',
    ]) {
      vi.stubEnv(name, undefined);
      vi.stubEnv(`${name}_FILE`, undefined);
    }
    vi.stubEnv('NODE_ENV', 'production');
  }

  it('applies the runtime URL without inventing a direct URL', () => {
    clearDatabaseEnv();
    vi.stubEnv('DATABASE_URL_FILE', '/pool');
    expect(resolveDatabaseUrl({ fs: secretFs({ '/pool': pooledUrl }) })).toBe(pooledUrl);
    expect(process.env.DATABASE_URL).toBe(pooledUrl);
    expect(process.env.DIRECT_DATABASE_URL).toBeUndefined();
    vi.stubEnv('DIRECT_DATABASE_URL', directUrl);
    expect(resolveDatabaseUrl({ fs: secretFs({ '/pool': pooledUrl }), preferDirect: true })).toBe(
      directUrl
    );
    expect(process.env.DIRECT_DATABASE_URL).toBe(directUrl);
  });

  it('leaves process.env alone when applyToEnv is false or a custom environment is supplied', () => {
    clearDatabaseEnv();
    vi.stubEnv('DATABASE_URL_FILE', '/pool');
    const fs = secretFs({ '/pool': pooledUrl });
    expect(resolveDatabaseUrl({ fs, applyToEnv: false })).toBe(pooledUrl);
    expect(process.env.DATABASE_URL).toBeUndefined();
    expect(resolveDatabaseUrl({ fs, env: { DATABASE_URL: directUrl } })).toBe(directUrl);
    expect(process.env.DATABASE_URL).toBeUndefined();
  });
});
