import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's scrypt alternative: 32 MiB, N=2^15, r=8, p=3. No native addon.
const PREFIX = 'scrypt-32768-8-3';
let active = 0;
async function derive(password: string, salt: string) {
  if (active >= 2) throw new Error('Emergency authentication temporarily busy. Retry shortly.');
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        32,
        { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key))
      )
    );
  } finally {
    active--;
  }
}
export async function generateEmergencyPassword() {
  const password = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const hash = `${PREFIX}$${salt}$${(await derive(password, salt)).toString('hex')}`;
  return { password, hash };
}
export async function verifyEmergencyPassword(password: string, stored: string | null) {
  const valid = stored?.match(/^scrypt-32768-8-3\$([a-f0-9]{32})\$([a-f0-9]{64})$/);
  // Unknown/malformed accounts still perform the same bounded KDF work.
  const actual = await derive(password, valid?.[1] ?? '00000000000000000000000000000000');
  const expected = Buffer.from(valid?.[2] ?? '00'.repeat(32), 'hex');
  return timingSafeEqual(actual, expected) && Boolean(valid);
}
