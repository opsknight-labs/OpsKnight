import { createHash } from 'node:crypto';

/** Stable digest for encrypted context integrity and bounded source snapshots. Never logs its input. */
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
