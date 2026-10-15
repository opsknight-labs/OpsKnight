import { sanitizeContext, sanitizeString } from '@/lib/logger';

/**
 * Public projection of AuditLog.details for the REST API.
 *
 * Audit details are written by many subsystems and are not guaranteed to be free
 * of secrets, so they are never returned raw. Values pass through the shared
 * logger redaction (credential-like keys and secret-shaped strings), then are
 * bounded in depth, width and string length so a single record cannot become a
 * data-exfiltration channel or an oversized response.
 */

// Identifiers and labels that match the logger's broad credential key patterns but
// carry no secret material.
const SAFE_KEYS = new Set([
  'apiKeyId',
  'apiClientId',
  'label',
  'keyId',
  'tokenId',
  'tokenName',
  'tokenPrefix',
  'prefix',
  'scopes',
  'sessionId',
]);

const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 50;
const MAX_STRING_LENGTH = 500;

function bound(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map(item => bound(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== '__proto__' && key !== 'constructor' && key !== 'prototype')
      .slice(0, MAX_OBJECT_KEYS)
      .map(([key, nested]) => [key, bound(nested, depth + 1)])
  );
}

export function projectAuditDetails(details: unknown): unknown {
  if (details === null || details === undefined) return null;
  if (typeof details !== 'object' || Array.isArray(details)) {
    return bound(sanitizeContext(details), 0);
  }

  const source = details as Record<string, unknown>;
  const preserved: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (SAFE_KEYS.has(key) && typeof value === 'string') {
      preserved[key] = sanitizeString(value);
    } else if (
      SAFE_KEYS.has(key) &&
      Array.isArray(value) &&
      value.every(v => typeof v === 'string')
    ) {
      preserved[key] = value.map(v => sanitizeString(v as string));
    } else {
      rest[key] = value;
    }
  }

  const sanitizedRest = sanitizeContext(rest) as Record<string, unknown>;
  return bound({ ...sanitizedRest, ...preserved }, 0);
}
