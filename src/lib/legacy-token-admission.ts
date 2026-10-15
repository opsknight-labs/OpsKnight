import 'server-only';
import type { NextRequest } from 'next/server';
import { hashLegacyTokenCandidates, isLegacy1xTokenShape } from '@/lib/api-keys';
import { getClientIp } from '@/lib/client-ip';
import {
  acquireLegacyScryptSlot,
  checkLegacyTokenAdmission,
  legacyAdmissionRetryAfterSeconds,
} from '@/lib/api-v2/rate-limit';

export type LegacyCandidateResult =
  | { status: 'ok'; candidates: string[] }
  | { status: 'throttled'; retryAfter: number };

/**
 * Legacy-hash fallback shared by every credential path (REST v2, /api/v1, /api/*, status-page
 * tokens). 1.x tokens need scrypt, which is CPU- and memory-hard, so the same admission budget
 * and per-process concurrency ceiling used by REST v2 applies wherever the fallback runs.
 * Non-1.x-shaped tokens only produce cheap HMAC candidates and are never throttled here.
 */
export async function legacyHashCandidatesWithAdmission(
  req: NextRequest,
  token: string
): Promise<LegacyCandidateResult> {
  if (!isLegacy1xTokenShape(token)) {
    return { status: 'ok', candidates: await hashLegacyTokenCandidates(token) };
  }
  if (!(await checkLegacyTokenAdmission(getClientIp(req)))) {
    return { status: 'throttled', retryAfter: legacyAdmissionRetryAfterSeconds() };
  }
  let release: () => void;
  try {
    release = acquireLegacyScryptSlot();
  } catch {
    return { status: 'throttled', retryAfter: 1 };
  }
  try {
    return { status: 'ok', candidates: await hashLegacyTokenCandidates(token) };
  } finally {
    release();
  }
}
