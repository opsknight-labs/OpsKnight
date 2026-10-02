import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateProductionEnv } from '@/lib/env-validation';
import { logger } from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('validateProductionEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const validProductionEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://opsknight:strong_and_unique_db_password_123!@db:5432/opsknight_db',
    NEXTAUTH_SECRET: 'production_secret_with_more_than_32_characters_random_key_abc123',
    API_KEY_SECRET: 'independent_api_signing_secret_more_than_32_chars_xyz789',
    ENCRYPTION_KEY: '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba',
    NEXT_PUBLIC_APP_URL: 'https://ops.example.com',
  };

  it('skips validation when NODE_ENV is not production', () => {
    Object.assign(process.env, { NODE_ENV: 'development' });
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.API_KEY_SECRET;
    delete process.env.ENCRYPTION_KEY;

    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('skips validation when SKIP_ENV_VALIDATION is set', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.SKIP_ENV_VALIDATION = 'true';
    delete process.env.DATABASE_URL;

    expect(() => validateProductionEnv()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping environment validation')
    );
  });

  it('throws when required environment variables are missing', () => {
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.DATABASE_URL;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEYS;

    expect(() => validateProductionEnv()).toThrow(/Missing required environment variables/);
  });

  it('succeeds in production when all secrets are strong and valid', () => {
    Object.assign(process.env, validProductionEnv);

    expect(() => validateProductionEnv()).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Production environment variables validated')
    );
  });

  it('rejects known placeholder NEXTAUTH_SECRET in production', () => {
    Object.assign(process.env, validProductionEnv, {
      NEXTAUTH_SECRET: 'change_this_to_a_random_secret_in_production',
    });

    expect(() => validateProductionEnv()).toThrow(/Known insecure or placeholder secrets detected/);
    expect(() => validateProductionEnv()).toThrow(/NEXTAUTH_SECRET uses a known default placeholder/);
  });

  it('rejects NEXTAUTH_SECRET shorter than 32 characters in production', () => {
    Object.assign(process.env, validProductionEnv, {
      NEXTAUTH_SECRET: 'short_secret_20chars',
    });

    expect(() => validateProductionEnv()).toThrow(/NEXTAUTH_SECRET is too short/);
  });

  it('rejects missing API_KEY_SECRET in production', () => {
    Object.assign(process.env, validProductionEnv);
    delete process.env.API_KEY_SECRET;

    expect(() => validateProductionEnv()).toThrow(/API_KEY_SECRET/);
  });

  it('rejects API_KEY_SECRET reused as NEXTAUTH_SECRET in production', () => {
    Object.assign(process.env, validProductionEnv, {
      API_KEY_SECRET: validProductionEnv.NEXTAUTH_SECRET,
    });

    expect(() => validateProductionEnv()).toThrow(/must be independent from NEXTAUTH_SECRET/);
  });

  it('rejects known placeholder ENCRYPTION_KEY in production', () => {
    Object.assign(process.env, validProductionEnv, {
      ENCRYPTION_KEY: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    });

    expect(() => validateProductionEnv()).toThrow(/ENCRYPTION_KEY is a known weak or default placeholder/);
  });

  it('rejects all-zero weak ENCRYPTION_KEY in production', () => {
    Object.assign(process.env, validProductionEnv, {
      ENCRYPTION_KEY: '0'.repeat(64),
    });

    expect(() => validateProductionEnv()).toThrow(/ENCRYPTION_KEY is a known weak or default placeholder/);
  });

  it('rejects known placeholder key in ENCRYPTION_KEYS keyring', () => {
    delete process.env.ENCRYPTION_KEY;
    Object.assign(process.env, validProductionEnv, {
      ENCRYPTION_KEYS: 'k1:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    });

    expect(() => validateProductionEnv()).toThrow(/ENCRYPTION_KEYS contains a known weak or default placeholder key/);
  });

  it('supports versioned ENCRYPTION_KEYS keyring when all keys are strong', () => {
    delete process.env.ENCRYPTION_KEY;
    Object.assign(process.env, validProductionEnv, {
      ENCRYPTION_KEYS:
        'k2:68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba,k1:a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f8a9',
    });

    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('accepts a valid keyring when a deployment manifest also injects an unused weak legacy key', () => {
    Object.assign(process.env, validProductionEnv, {
      ENCRYPTION_KEY: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      ENCRYPTION_KEYS:
        'k2:68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba,k1:a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708192a3b4c5d6e7f8a9',
    });

    expect(() => validateProductionEnv()).not.toThrow();
  });

  it('rejects malformed ENCRYPTION_KEYS even when ENCRYPTION_KEY is present', () => {
    Object.assign(process.env, validProductionEnv, {
      ENCRYPTION_KEYS: 'not-a-valid-keyring',
    });

    expect(() => validateProductionEnv()).toThrow(/ENCRYPTION_KEYS is invalid/);
  });

  it('rejects default PostgreSQL password placeholder in DATABASE_URL', () => {
    Object.assign(process.env, validProductionEnv, {
      DATABASE_URL:
        'postgresql://opsknight:opsknight_secure_password_change_me@db:5432/opsknight_db',
    });

    expect(() => validateProductionEnv()).toThrow(/DATABASE_URL contains the default PostgreSQL password placeholder/);
  });

  it('rejects default POSTGRES_PASSWORD environment variable', () => {
    Object.assign(process.env, validProductionEnv, {
      POSTGRES_PASSWORD: 'opsknight_secure_password_change_me',
    });

    expect(() => validateProductionEnv()).toThrow(/POSTGRES_PASSWORD uses a known default placeholder/);
  });

  it('rejects the env.example development database password in production', () => {
    Object.assign(process.env, validProductionEnv, {
      POSTGRES_PASSWORD: 'devpassword',
    });

    expect(() => validateProductionEnv()).toThrow(/POSTGRES_PASSWORD uses a known default placeholder/);
  });

  it('rejects the NEXTAUTH_SECRET placeholder shipped in env.example', () => {
    Object.assign(process.env, validProductionEnv, {
      NEXTAUTH_SECRET: 'changeme_to_a_secure_random_string',
    });

    expect(() => validateProductionEnv()).toThrow(/NEXTAUTH_SECRET uses a known default placeholder/);
  });

  it('rejects the API_KEY_SECRET placeholder shipped in env.example', () => {
    Object.assign(process.env, validProductionEnv, {
      API_KEY_SECRET: 'changeme_to_a_different_secure_random_string',
    });

    expect(() => validateProductionEnv()).toThrow(/API_KEY_SECRET uses a known default placeholder/);
  });

  it('allows placeholder secrets when ALLOW_INSECURE_SECRETS is enabled', () => {
    Object.assign(process.env, validProductionEnv, {
      ALLOW_INSECURE_SECRETS: 'true',
      NEXTAUTH_SECRET: 'change_this_to_a_random_secret_in_production',
      ENCRYPTION_KEY: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      DATABASE_URL:
        'postgresql://opsknight:opsknight_secure_password_change_me@db:5432/opsknight_db',
    });

    expect(() => validateProductionEnv()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ALLOW_INSECURE_SECRETS is enabled')
    );
  });
});
