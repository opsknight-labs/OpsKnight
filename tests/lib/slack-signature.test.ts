import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import {
  verifySlackSignature,
  getSlackSigningSecret,
  resetSigningSecretCache,
  isTrustedSlackResponseUrl,
  toSlackResponseUrl,
} from '@/lib/slack-signature';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    slackOAuthConfig: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SECRET = 'test-signing-secret';
const BODY = 'payload=%7B%22type%22%3A%22block_actions%22%7D';

function sign(body: string, timestamp: string, secret: string): string {
  return (
    'v0=' + crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  );
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('Slack signature verification', () => {
  const originalSecret = process.env.SLACK_SIGNING_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSigningSecretCache();
    delete process.env.SLACK_SIGNING_SECRET;
    vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue(null as any);
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.SLACK_SIGNING_SECRET;
    } else {
      process.env.SLACK_SIGNING_SECRET = originalSecret;
    }
  });

  describe('secret resolution', () => {
    it('prefers the environment variable', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;

      await expect(getSlackSigningSecret()).resolves.toBe(SECRET);
      expect(prisma.slackOAuthConfig.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the encrypted secret on the Slack OAuth config', async () => {
      // Admin-entered in Settings > Slack. Slack never returns a signing secret
      // from OAuth, so this is the only real source besides the env override.
      vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue({
        signingSecret: 'encrypted_blob',
      } as any);
      vi.mocked(decrypt).mockResolvedValue(SECRET);

      await expect(getSlackSigningSecret()).resolves.toBe(SECRET);
      expect(decrypt).toHaveBeenCalledWith('encrypted_blob');
    });

    it('returns null when decryption fails rather than throwing', async () => {
      vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue({
        signingSecret: 'corrupt',
      } as any);
      vi.mocked(decrypt).mockRejectedValue(new Error('bad key'));

      await expect(getSlackSigningSecret()).resolves.toBeNull();
    });

    it('returns null when no source has a secret', async () => {
      await expect(getSlackSigningSecret()).resolves.toBeNull();
    });
  });

  describe('verification', () => {
    it('fails closed when no secret is configured', async () => {
      const ts = String(nowSeconds());
      const result = await verifySlackSignature(BODY, sign(BODY, ts, SECRET), ts);

      expect(result).toEqual({ valid: false, reason: 'no_secret' });
    });

    it('accepts a correctly signed request', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;
      const ts = String(nowSeconds());

      const result = await verifySlackSignature(BODY, sign(BODY, ts, SECRET), ts);
      expect(result).toEqual({ valid: true });
    });

    it('accepts a request signed with the secret from the database', async () => {
      vi.mocked(prisma.slackOAuthConfig.findFirst).mockResolvedValue({
        signingSecret: 'encrypted_blob',
      } as any);
      vi.mocked(decrypt).mockResolvedValue(SECRET);
      const ts = String(nowSeconds());

      const result = await verifySlackSignature(BODY, sign(BODY, ts, SECRET), ts);
      expect(result).toEqual({ valid: true });
    });

    it('rejects a signature made with a different secret', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;
      const ts = String(nowSeconds());

      const result = await verifySlackSignature(BODY, sign(BODY, ts, 'attacker-secret'), ts);
      expect(result).toEqual({ valid: false, reason: 'mismatch' });
    });

    it('rejects a tampered body', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;
      const ts = String(nowSeconds());
      const signature = sign(BODY, ts, SECRET);

      const result = await verifySlackSignature(BODY + '&extra=1', signature, ts);
      expect(result).toEqual({ valid: false, reason: 'mismatch' });
    });

    it('rejects a replayed request older than five minutes', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;
      const ts = String(nowSeconds() - 601);

      const result = await verifySlackSignature(BODY, sign(BODY, ts, SECRET), ts);
      expect(result).toEqual({ valid: false, reason: 'stale_timestamp' });
    });

    it('rejects a request whose signature was made for a different body length', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;
      const ts = String(nowSeconds());

      const result = await verifySlackSignature(BODY, sign(BODY, ts, SECRET).slice(0, 20), ts);
      expect(result).toEqual({ valid: false, reason: 'mismatch' });
    });

    it('rejects missing headers without throwing on length mismatch', async () => {
      process.env.SLACK_SIGNING_SECRET = SECRET;

      await expect(verifySlackSignature(BODY, '', '')).resolves.toEqual({
        valid: false,
        reason: 'missing_headers',
      });

      const ts = String(nowSeconds());
      await expect(verifySlackSignature(BODY, 'v0=short', ts)).resolves.toEqual({
        valid: false,
        reason: 'mismatch',
      });
    });
  });

  describe('response_url trust check', () => {
    // response_url arrives in the request body, so fetching it unchecked is a
    // server-side request forgery primitive (CodeQL js/request-forgery).
    it('accepts Slack response URLs', () => {
      expect(isTrustedSlackResponseUrl('https://hooks.slack.com/actions/T1/2/abc')).toBe(true);
    });

    it('rebuilds the URL against a literal Slack origin', () => {
      // The returned host is a constant, so no input can redirect the request.
      expect(toSlackResponseUrl('https://hooks.slack.com/actions/T1/2/abc')).toBe(
        'https://hooks.slack.com/actions/T1/2/abc'
      );
      // Query strings are dropped — Slack never sets one
      expect(toSlackResponseUrl('https://hooks.slack.com/actions/T1/2/abc?x=1')).toBe(
        'https://hooks.slack.com/actions/T1/2/abc'
      );
      // Path must match the expected shape
      expect(toSlackResponseUrl('https://hooks.slack.com/a/../../b')).toBeNull();
      expect(toSlackResponseUrl('https://hooks.slack.com/actions/T1/2/a%2Fb')).toBeNull();
      expect(toSlackResponseUrl('https://hooks.slack.com/')).toBeNull();
      expect(toSlackResponseUrl('https://attacker.example.com/x')).toBeNull();
    });

    it('rejects internal and metadata targets', () => {
      const hostile = [
        'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
        'http://localhost:3000/api/admin',
        'http://127.0.0.1/',
        'https://attacker.example.com/collect',
        // Lookalike hosts that a naive substring check would accept
        'https://hooks.slack.com.attacker.example.com/x',
        'https://attacker.example.com/?q=hooks.slack.com',
        // Right host, wrong scheme
        'http://hooks.slack.com/actions/T1/2/abc',
      ];

      for (const url of hostile) {
        expect(isTrustedSlackResponseUrl(url), url).toBe(false);
      }
    });

    it('rejects absent or malformed values', () => {
      for (const value of [undefined, null, '', 'not-a-url', 42, {}]) {
        expect(isTrustedSlackResponseUrl(value)).toBe(false);
      }
    });
  });
});
