import { describe, expect, it } from 'vitest';
import { resolveScimRole } from '@/lib/scim/lifecycle/roles';
import type { Role, RoleSource } from '@prisma/client';

describe('SCIM group role authority is explicitly adopted', () => {
  it.each<Role>(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'])(
    'preserves a legacy SCIM %s when no mapping matches',
    role => {
      const legacy = { role, roleSource: 'SCIM' as const, scimRoleMappingAdopted: false };
      expect(resolveScimRole([], legacy)).toEqual(legacy);
    }
  );
  it('adopts a matching mapping even when the role and legacy source already match', () => {
    expect(
      resolveScimRole(['RESPONDER'], {
        role: 'RESPONDER',
        roleSource: 'SCIM',
        scimRoleMappingAdopted: false,
      })
    ).toEqual({ role: 'RESPONDER', roleSource: 'SCIM', scimRoleMappingAdopted: true });
  });
  it('revokes a previously adopted role when its last mapped group stops contributing', () => {
    expect(
      resolveScimRole([], {
        role: 'ADMIN',
        roleSource: 'SCIM',
        scimRoleMappingAdopted: true,
      })
    ).toEqual({ role: 'USER', roleSource: 'SCIM', scimRoleMappingAdopted: true });
  });
  it.each<RoleSource>(['MANUAL', 'OIDC'])(
    'preserves an explicitly released %s role after removal of all mapped memberships',
    roleSource => {
      const released = { role: 'AUDITOR' as const, roleSource, scimRoleMappingAdopted: true };
      expect(resolveScimRole([], released)).toEqual(released);
    }
  );
  it('uses the established precedence for overlapping mapped groups regardless of order', () => {
    expect(
      resolveScimRole(['AUDITOR', 'ADMIN', 'RESPONDER'], {
        role: 'USER',
        roleSource: 'MANUAL',
        scimRoleMappingAdopted: false,
      })
    ).toEqual({ role: 'ADMIN', roleSource: 'SCIM', scimRoleMappingAdopted: true });
  });
});
