import crypto from 'crypto';
import type { NextRequest } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export function extractIntegrationKey(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') || '';
  const lower = authHeader.toLowerCase();

  if (lower.startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  if (lower.startsWith('token token=')) {
    return authHeader.slice('token token='.length).trim();
  }

  const direct = req.headers.get('x-integration-key') || req.headers.get('x-api-key');
  if (direct) {
    return direct.trim();
  }

  // Fallback for providers that cannot set headers (e.g., some webhook senders).
  const { searchParams } = new URL(req.url);
  const queryKey =
    searchParams.get('integrationKey') ||
    searchParams.get('integration_key') ||
    searchParams.get('key');
  return queryKey?.trim() || null;
}

export function isIntegrationAuthorized(req: NextRequest, expectedKey: string): boolean {
  const provided = extractIntegrationKey(req);
  if (!provided) return false;
  return safeEqual(provided, expectedKey);
}
