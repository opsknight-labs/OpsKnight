import { createHmac, randomBytes } from 'node:crypto';
import { ScimFailure } from '../protocol/validation';

const secret = randomBytes(32);
const networks = new Map<string, { count: number; until: number }>();
const verified = new Map<string, number>();
class Lane {
  private active = 0;
  private waiters: Array<() => void> = [];
  async acquire(): Promise<() => void> {
    if (this.active >= 2) {
      if (this.waiters.length >= 16) throw new ScimFailure(429, 'SCIM authentication is busy.');
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          const index = this.waiters.indexOf(wake);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new ScimFailure(429, 'SCIM authentication is busy.'));
        }, 100);
        this.waiters.push(wake);
      });
    } else this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    };
  }
}
const unknownLane = new Lane();
const verifiedLane = new Lane();
let windowStart = 0;
let attempts = 0;

/** Process-local work budgets precede every database credential lookup. Hints
 * select a lane only; every admitted credential is still verified in PostgreSQL. */
export async function acquireScimAdmission(tokenHash: string, clientIp?: string) {
  const now = Date.now();
  const priority = (verified.get(tokenHash) ?? 0) > now;
  if (!priority) {
    if (now - windowStart >= 60000) {
      windowStart = now;
      attempts = 0;
    }
    if (attempts >= 1200)
      throw new ScimFailure(429, 'SCIM authentication is busy. Retry in one minute.');
    if (clientIp && clientIp !== '0.0.0.0' && clientIp !== 'unknown') {
      const key = createHmac('sha256', secret).update(clientIp).digest('hex');
      const entry = networks.get(key);
      if (entry && entry.until > now) {
        if (entry.count >= 120)
          throw new ScimFailure(429, 'SCIM network admission limit exceeded.');
        entry.count++;
      } else {
        if (networks.size >= 4096) networks.delete(networks.keys().next().value!);
        networks.set(key, { count: 1, until: now + 60000 });
      }
    }
    attempts++;
  }
  const release = await (priority ? verifiedLane : unknownLane).acquire();
  return {
    release,
    remember(valid: boolean) {
      if (!valid) {
        verified.delete(tokenHash);
        return;
      }
      if (verified.size >= 4096) verified.delete(verified.keys().next().value!);
      verified.set(tokenHash, Date.now() + 60000);
    },
  };
}
