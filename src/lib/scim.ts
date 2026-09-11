import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function isScimRequestAuthorized(authorization: string | null): boolean {
  const configured = process.env.SCIM_BEARER_TOKEN?.trim() ?? '';
  if (configured.length < 32 || !authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length).trim();
  return supplied.length > 0 && timingSafeEqual(digest(supplied), digest(configured));
}

export function scimError(status: number, detail: string) {
  return Response.json(
    { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export type ScimUserShape = {
  id: string;
  scimExternalId: string | null;
  email: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeScimUser(user: ScimUserShape) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    externalId: user.scimExternalId ?? undefined,
    userName: user.email,
    displayName: user.name,
    name: { formatted: user.name },
    emails: [{ value: user.email, primary: true, type: 'work' }],
    active: user.status !== 'DISABLED',
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

export function parseScimFilter(
  filter: string | null
): { scimExternalId: string } | { email: string } | null {
  if (!filter) return null;
  const match = /^(externalId|userName)\s+eq\s+"([^"\r\n]{1,320})"$/i.exec(filter.trim());
  if (!match) throw new Error('Unsupported SCIM filter. Use externalId eq or userName eq.');
  return match[1].toLowerCase() === 'externalid'
    ? { scimExternalId: match[2] }
    : { email: match[2].trim().toLowerCase() };
}
