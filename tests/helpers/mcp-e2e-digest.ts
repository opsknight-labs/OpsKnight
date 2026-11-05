import { createHmac, hkdfSync } from 'node:crypto';

/**
 * The credential digest the server stores (digestMcpSecret in src/lib/mcp/auth/config.ts), written
 * out so browser-less end-to-end specs can mint credentials without loading the application's
 * database client. tests/mcp/e2e-digest.test.ts fails if this ever differs from the real one.
 */
export function e2eDigest(value: string, encryptionKey = process.env.ENCRYPTION_KEY) {
  if (!encryptionKey) throw new Error('ENCRYPTION_KEY must match the server under test');
  const derived = Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKey, 'hex'), 'opsknight:mcp', 'credential-hash:v1', 32)
  );
  return createHmac('sha256', derived).update('opsknight:mcp:v1\0').update(value).digest('hex');
}
