import { createHash } from 'node:crypto';

/** The routing key is generated from 256 bits of randomness; a fast digest is safe for indexed lookup. */
export function integrationKeyFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
