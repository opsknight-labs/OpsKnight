import { describe, expect, it } from 'vitest';
import entra from '../fixtures/scim/entra.json';
import okta from '../fixtures/scim/okta.json';
import { applyProfileAuthority } from '@/lib/scim/lifecycle/profile';
import { equalityFilter } from '@/lib/scim/protocol/filters';
import { patchGroup, patchUser } from '@/lib/scim/protocol/patch';
import {
  normalizeAttributes,
  pagination,
  readBody,
  userSchema,
  groupSchema,
  parse,
  enterpriseSchema,
  ScimFailure,
  USERNAME_EMAIL_MISMATCH,
} from '@/lib/scim/protocol/validation';

const user = {
  userName: 'alice@example.test',
  externalId: 'dir-1',
  displayName: 'Alice',
  active: true,
};
const patch = (...Operations: unknown[]) => ({ Operations });
describe('bounded SCIM protocol and ordered PATCH', () => {
  it.each(['1.2', '-1', 'NaN', 'Infinity', '1e3', ' 2', ''])('rejects invalid count %s', count => {
    expect(() => pagination(new URLSearchParams({ count }))).toThrow();
  });
  it('supports count zero and bounds pagination', () => {
    expect(pagination(new URLSearchParams('count=0'))).toEqual({ count: 0, startIndex: 1 });
    expect(pagination(new URLSearchParams('count=999&startIndex=2'))).toEqual({
      count: 100,
      startIndex: 2,
    });
  });
  it('normalizes case without accepting ambiguous attributes', () => {
    expect(normalizeAttributes({ UserName: 'a@example.test', NAME: { GivenName: 'A' } })).toEqual({
      userName: 'a@example.test',
      name: { givenName: 'A' },
    });
    expect(() => normalizeAttributes({ active: true, ACTIVE: false })).toThrow(/duplicate/i);
  });
  it('rejects malformed and oversized bodies', async () => {
    await expect(
      readBody(new Request('https://test', { method: 'POST', body: '{' }))
    ).rejects.toThrow(/malformed/i);
    await expect(
      readBody(
        new Request('https://test', {
          method: 'POST',
          body: JSON.stringify({ displayName: 'x'.repeat(1024 * 1024) }),
        })
      )
    ).rejects.toMatchObject({ status: 413 });
  });
  it('handles common Entra work-email paths and active strings', () => {
    expect(
      patchUser(
        user,
        patch(
          { op: 'Replace', path: 'emails[type eq "work"].value', value: 'new@example.test' },
          { op: 'replace', path: 'active', value: 'False' }
        )
      )
    ).toMatchObject({ userName: 'new@example.test', active: false });
  });
  it('names the attributes when the work email differs from userName (Entra UPN ≠ mail)', () => {
    const create = {
      ...user,
      userName: 'alice.upn@corp.example.test',
      emails: [{ value: 'alice@example.test', type: 'work', primary: true }],
    };
    let failure: unknown;
    try {
      parse(userSchema, create);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ScimFailure);
    expect(failure).toMatchObject({ status: 400, scimType: 'invalidValue' });
    const detail = (failure as ScimFailure).message;
    expect(detail).toBe(`emails: ${USERNAME_EMAIL_MISMATCH}`);
    expect(detail).toContain('emails[type eq "work"].value');
    expect(detail).toContain('userName');
    expect(detail).toContain('Entra: mail');
    expect(detail).toContain('Okta: user.email');
    // The IdP error must not echo either submitted address.
    expect(detail).not.toContain('alice');
    // A matching work email (case-insensitive) is still accepted.
    expect(parse(userSchema, { ...create, userName: 'Alice@Example.test' }).userName).toBe(
      'alice@example.test'
    );
  });
  it('updates structured names and enterprise department', () => {
    expect(
      patchUser(
        user,
        patch(
          { op: 'replace', path: 'name', value: { givenName: 'Alice', familyName: 'Ng' } },
          { op: 'replace', path: `${enterpriseSchema}:department`, value: 'SRE' }
        )
      )
    ).toMatchObject({
      name: { givenName: 'Alice', familyName: 'Ng' },
      [enterpriseSchema]: { department: 'SRE' },
    });
  });
  it('rejects unsupported attributes, authority writes, and mutable external identities', () => {
    for (const path of ['roles', 'roleSource', 'password', 'unknown', 'externalId'])
      expect(() => patchUser(user, patch({ op: 'replace', path, value: 'attacker' }))).toThrow();
    expect(() => parse(userSchema, { ...user, active: 'invalid' })).toThrow();
  });
  it('accepts standard User member types on create and ordered PATCH, but rejects nested groups', () => {
    expect(
      groupSchema.parse({ displayName: 'Team', members: [{ value: 'user-1', type: 'User' }] })
        .members
    ).toHaveLength(1);
    expect(
      patchGroup(
        { displayName: 'Team', members: [] },
        patch({ op: 'add', path: 'members', value: [{ value: 'user-1', type: 'User' }] })
      ).members
    ).toEqual([{ value: 'user-1' }]);
    expect(() =>
      groupSchema.parse({ displayName: 'Team', members: [{ value: 'group-1', type: 'Group' }] })
    ).toThrow();
  });
  it('removes optional displayName without removing structured names or required login attributes', () => {
    const result = patchUser(
      { ...user, name: { formatted: 'Alice', givenName: 'Alice', familyName: 'Ng' } },
      patch({ op: 'remove', path: 'displayName' })
    );
    expect(result.displayName).toBeUndefined();
    expect(result.name).toEqual({ givenName: 'Alice', familyName: 'Ng' });
    expect(result.userName).toBe(user.userName);
    expect(result.active).toBe(true);
  });

  it('applies group membership operations in exact request order', () => {
    const group = { displayName: 'Directory', members: [{ value: 'a' }] };
    expect(
      patchGroup(
        group,
        patch(
          { op: 'add', path: 'members', value: [{ value: 'b' }] },
          { op: 'remove', path: 'members[value eq "b"]' },
          { op: 'replace', path: 'members', value: [{ value: 'c' }] },
          { op: 'add', path: 'members', value: [{ value: 'd' }] }
        )
      )
    ).toMatchObject({ members: [{ value: 'c' }, { value: 'd' }] });
    expect(group.members).toEqual([{ value: 'a' }]);
  });
  it('rejects an invalid final operation without mutating the input', () => {
    const group = { displayName: 'Old', members: [] };
    expect(() =>
      patchGroup(
        group,
        patch(
          { op: 'replace', path: 'displayName', value: 'New' },
          { op: 'replace', path: 'unsupported', value: [] }
        )
      )
    ).toThrow(/unsupported/i);
    expect(group.displayName).toBe('Old');
  });
});

describe('provider fixtures and attribute ownership', () => {
  it.each([entra.userPatch, okta.userPatch])(
    'accepts documented provider deactivation shapes',
    fixture => {
      expect(patchUser(user, normalizeAttributes(fixture))).toMatchObject({ active: false });
    }
  );
  it('handles documented Entra removal and Okta replacement shapes', () => {
    const group = { displayName: 'Provider fixture', members: [{ value: 'user-id' }] };
    expect(patchGroup(group, normalizeAttributes(entra.groupRemove)).members).toEqual([]);
    expect(patchGroup(group, normalizeAttributes(okta.groupReplace)).members).toEqual([
      { value: 'user-id' },
    ]);
  });
  it('preserves external attribute authority and rejects attempted takeovers', () => {
    const current = {
      email: 'local@example.test',
      name: 'Local owner',
      jobTitle: 'SRE',
      department: 'Operations',
      scimGivenName: null,
      scimFamilyName: null,
      avatarUrl: null,
    };
    const next = { ...current, name: 'Directory name', jobTitle: null, department: null };
    expect(applyProfileAuthority(next, current, ['name'], new Set(['name']))).toMatchObject({
      name: 'Directory name',
      jobTitle: 'SRE',
      department: 'Operations',
    });
    expect(() =>
      applyProfileAuthority(
        { ...current, jobTitle: 'Attacker title' },
        current,
        [],
        new Set(['title'])
      )
    ).toThrow(/managed outside/i);
  });
  it('decodes quoted filters and rejects mismatched or unquoted literals', () => {
    expect(equalityFilter('externalId eq "directory\\\"id"', ['externalid'])).toEqual({
      attribute: 'externalid',
      value: 'directory"id',
    });
    for (const filter of [
      'externalId eq bare',
      'externalId eq "mixed\'',
      'externalId eq "valid" or userName pr',
    ])
      expect(() => equalityFilter(filter, ['externalid'])).toThrow();
  });
});

describe('IdP default attribute mappings', () => {
  const user = { userName: 'alice@example.test', active: true };
  const patch = (...Operations: unknown[]) => ({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
    Operations,
  });

  it('accepts an Okta create body with password, locale and groups, keeping only stored fields', () => {
    const parsed = parse(
      userSchema,
      normalizeAttributes({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'Alice@Example.test',
        name: { givenName: 'Alice', familyName: 'Ng', middleName: 'Q' },
        emails: [{ primary: true, value: 'alice@example.test', type: 'work', display: 'x' }],
        displayName: 'Alice Ng',
        locale: 'en-US',
        externalId: '00u1',
        groups: [],
        password: 'secret-from-okta',
        active: true,
      })
    ) as Record<string, unknown>;
    expect(parsed).toMatchObject({ userName: 'alice@example.test', externalId: '00u1' });
    expect(parsed.password).toBeUndefined();
    expect(parsed.locale).toBeUndefined();
    expect(parsed.name).toEqual({ givenName: 'Alice', familyName: 'Ng' });
  });

  it('accepts Entra default attributes on create and PATCH as no-ops', () => {
    const parsed = parse(
      userSchema,
      normalizeAttributes({
        userName: 'alice@example.test',
        active: true,
        preferredLanguage: 'en-US',
        phoneNumbers: [{ type: 'work', value: '1' }],
        addresses: [{ type: 'work', formatted: 'x' }],
        [enterpriseSchema]: { department: 'SRE', employeeNumber: '7', manager: { value: 'm' } },
      })
    );
    expect(parsed[enterpriseSchema]).toEqual({ department: 'SRE' });

    const result = patchUser(
      user,
      patch(
        { op: 'replace', path: 'preferredLanguage', value: 'en-US' },
        { op: 'add', path: 'phoneNumbers[type eq "work"].value', value: '1' },
        { op: 'add', path: 'addresses[type eq "work"].formatted', value: 'x' },
        { op: 'replace', path: `${enterpriseSchema}:employeeNumber`, value: '7' },
        { op: 'replace', path: `${enterpriseSchema}:manager`, value: 'm' },
        { op: 'replace', path: 'displayName', value: 'Alice' }
      )
    );
    expect(result).toEqual({ ...user, displayName: 'Alice' });
  });
});
