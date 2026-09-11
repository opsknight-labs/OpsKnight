import { afterEach, describe, expect, it } from 'vitest';
import { isScimRequestAuthorized, parseScimFilter, serializeScimUser } from '@/lib/scim';

const originalToken = process.env.SCIM_BEARER_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.SCIM_BEARER_TOKEN;
  else process.env.SCIM_BEARER_TOKEN = originalToken;
});

describe('SCIM protocol helpers', () => {
  it('fails closed without a strong configured bearer token', () => {
    delete process.env.SCIM_BEARER_TOKEN;
    expect(isScimRequestAuthorized('Bearer anything')).toBe(false);
    process.env.SCIM_BEARER_TOKEN = 'short';
    expect(isScimRequestAuthorized('Bearer short')).toBe(false);
  });

  it('compares a configured bearer token exactly', () => {
    process.env.SCIM_BEARER_TOKEN = 'a-secure-scim-token-with-at-least-32-characters';
    expect(isScimRequestAuthorized(`Bearer ${process.env.SCIM_BEARER_TOKEN}`)).toBe(true);
    expect(isScimRequestAuthorized('Bearer wrong-token')).toBe(false);
  });

  it('accepts only bounded externalId and userName equality filters', () => {
    expect(parseScimFilter('externalId eq "directory-123"')).toEqual({
      scimExternalId: 'directory-123',
    });
    expect(parseScimFilter('userName eq "USER@Example.com"')).toEqual({
      email: 'user@example.com',
    });
    expect(() => parseScimFilter('userName co "example"')).toThrow(/unsupported/i);
  });

  it('serializes an OpsKnight user as a SCIM user resource', () => {
    const timestamp = new Date('2026-09-11T00:00:00.000Z');
    expect(
      serializeScimUser({
        id: 'u1',
        scimExternalId: 'directory-1',
        email: 'user@example.com',
        name: 'User',
        status: 'DISABLED',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    ).toMatchObject({
      id: 'u1',
      externalId: 'directory-1',
      userName: 'user@example.com',
      active: false,
    });
  });
});
