import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('user management security contract', () => {
  it('keeps self-protection synchronous at action call sites', () => {
    const rbac = readFileSync('src/lib/rbac.ts', 'utf8');
    const actions = readFileSync('src/app/(app)/users/actions.ts', 'utf8');

    expect(rbac).toContain('export function assertNotSelf(');
    expect(rbac).not.toContain('export async function assertNotSelf(');
    expect(actions.match(/assertNotSelf\(/g)).toHaveLength(4);
  });

  it('uses immutable identity and explicit generation for invitation claims', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const acceptance = readFileSync('src/app/set-password/actions.ts', 'utf8');

    expect(schema).toContain('invitationGeneration');
    expect(schema).toContain('userId     String?');
    expect(acceptance).toContain("status: 'INVITED'");
    expect(acceptance).toContain('invitationGeneration: record.generation');
    expect(acceptance).toContain('revokedAt: null');
  });

  it('keeps OIDC approval separate from expiring bearer credentials', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const actions = readFileSync('src/app/(app)/users/oidc-actions.ts', 'utf8');

    expect(schema).toContain('model OidcLinkingApproval');
    expect(actions).toContain('prisma.oidcLinkingApproval');
    expect(actions).not.toContain('prisma.userToken.create');
  });

  it('projects an explicit safe profile DTO before crossing the client boundary', () => {
    const page = readFileSync('src/app/(app)/users/[id]/page.tsx', 'utf8');
    const dto = page.slice(page.indexOf('const transformedUser = {'), page.indexOf('return ('));

    expect(dto).not.toContain('...user');
    expect(dto).not.toContain('passwordHash');
    expect(dto).not.toContain('tokenVersion');
  });

  it('requires mobile user routes to use the current authorization guard', () => {
    const list = readFileSync('src/app/(mobile)/m/users/page.tsx', 'utf8');
    const detail = readFileSync('src/app/(mobile)/m/users/[id]/page.tsx', 'utf8');

    expect(list).toContain('await getCurrentUser()');
    expect(detail).toContain('await getCurrentUser()');
  });

  it('centralizes membership removal and last-admin serialization', () => {
    const teams = readFileSync('src/app/(app)/teams/actions.ts', 'utf8');
    const users = readFileSync('src/app/(app)/users/actions.ts', 'utf8');
    const invariant = readFileSync('src/lib/users/admin-invariants.ts', 'utf8');

    expect(teams).toContain('removeTeamMembership(memberId)');
    expect(users).toContain('removeTeamMembership(memberId)');
    expect(invariant).toContain('LOCK_KEYS.USER_ADMIN_INVARIANT');
    expect(invariant).toContain("status: 'ACTIVE'");
    expect(invariant).toContain('runSerializableTransaction(');
  });

  it('declares a lifecycle disposition for every direct User relation', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const policy = readFileSync('src/lib/users/reference-policy.ts', 'utf8');
    const userModel = schema.slice(
      schema.indexOf('model User {'),
      schema.indexOf('model UserAvatar')
    );
    const scalarTypes = new Set(['String', 'Int', 'Boolean', 'DateTime', 'Json', 'Bytes']);
    const relationLines = userModel
      .split('\n')
      .filter(line => /^\s{2}[a-zA-Z]\w+\s+/.test(line))
      .map(line => line.trim().split(/\s+/))
      .filter(parts => parts.length >= 2)
      .filter(parts => !scalarTypes.has(parts[1].replace(/[?\[\]]/g, '')))
      .filter(parts => !['Role', 'UserStatus'].includes(parts[1].replace(/[?\[\]]/g, '')))
      .map(parts => parts[0]);

    for (const relation of relationLines) {
      expect(policy, `Missing UserReferencePolicy for ${relation}`).toContain(`${relation}:`);
    }
  });
});
