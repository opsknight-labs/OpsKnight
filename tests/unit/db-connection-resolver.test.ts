import { describe, expect, it } from 'vitest';
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
      const result = readSecretFile('/run/secrets/my_secret', mockFs as any);
      expect(result).toBe('postgresql://user:secret@host:5432/db');
    });

    it('returns null if file does not exist or is not a regular file', () => {
      const mockFs = {
        existsSync: () => false,
        statSync: () => ({ isFile: () => false }),
        readFileSync: () => '',
      };
      expect(readSecretFile('/nonexistent', mockFs as any)).toBeNull();
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
        fs: mockFs as any,
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
        fs: mockFs as any,
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
        fs: mockFs as any,
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
        fs: mockFs as any,
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
        fs: mockFs as any,
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
      const diagnostics = getDatabaseDiagnostics({ env: mockEnv, fs: mockFs as any });
      expect(diagnostics).toContain('Database connection diagnostics:');
      expect(diagnostics).toContain('DATABASE_URL: not set');
      expect(diagnostics).toContain(
        'DATABASE_URL_FILE: "/run/secrets/opsknight_database_url" -> found (45 bytes)'
      );
      expect(diagnostics).not.toContain('password');
      expect(diagnostics).not.toContain('super_secret_pw');
    });
  });
});
