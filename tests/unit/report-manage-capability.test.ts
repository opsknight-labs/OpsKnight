import { describe, expect, it } from 'vitest';
import {
  APP_ROLES,
  CAPABILITIES,
  getRoleCapabilities,
  hasCapability,
  type AppRole,
  type Capability,
} from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { CAPABILITY_CATALOG } from '@/lib/access/catalog';
import { canAccessPath } from '@/lib/access/pages';

const actor = (role: AppRole, capabilities?: readonly Capability[]): AuthorizationActor => ({
  id: 'u1',
  role,
  status: 'ACTIVE',
  teamIds: [],
  ...(capabilities ? { capabilities: new Set(capabilities) } : {}),
});
const may = (a: AuthorizationActor, action: (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS]) =>
  authorize({ actor: a, action }).allowed;

describe('report.manage', () => {
  it('is a distinct capability from report.read', () => {
    expect(CAPABILITIES.REPORT_MANAGE).toBe('report.manage');
    expect(CAPABILITIES.REPORT_MANAGE).not.toBe(CAPABILITIES.REPORT_READ);
  });

  it('is held by every built-in role that could write before, except the read-only ones', () => {
    for (const role of APP_ROLES) {
      const holdsRead = hasCapability(role, CAPABILITIES.REPORT_READ);
      const holdsManage = hasCapability(role, CAPABILITIES.REPORT_MANAGE);
      if (role === 'AUDITOR' || role === 'STAKEHOLDER') expect(holdsManage, role).toBe(false);
      else expect(holdsManage, role).toBe(holdsRead);
    }
    expect(getRoleCapabilities('ADMIN')).toContain(CAPABILITIES.REPORT_MANAGE);
    expect(getRoleCapabilities('RESPONDER')).toContain(CAPABILITIES.REPORT_MANAGE);
    expect(getRoleCapabilities('USER')).toContain(CAPABILITIES.REPORT_MANAGE);
  });

  it('keeps AUDITOR able to read and export reports but not to create, change or delete them', () => {
    const auditor = actor('AUDITOR');
    expect(may(auditor, AUTHORIZATION_ACTIONS.REPORT_READ)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.REPORT_EXPORT)).toBe(true);
    expect(may(auditor, AUTHORIZATION_ACTIONS.REPORT_MANAGE)).toBe(false);
  });

  it.each(['ADMIN', 'RESPONDER', 'USER'] as const)('still lets %s manage reports', role => {
    expect(may(actor(role), AUTHORIZATION_ACTIONS.REPORT_MANAGE)).toBe(true);
  });

  it('is decided by the effective capabilities, so a custom role needs report.manage to write', () => {
    const readOnlyCustom = actor('USER', [CAPABILITIES.REPORT_READ]);
    expect(may(readOnlyCustom, AUTHORIZATION_ACTIONS.REPORT_READ)).toBe(true);
    expect(may(readOnlyCustom, AUTHORIZATION_ACTIONS.REPORT_MANAGE)).toBe(false);

    const managingCustom = actor('USER', [CAPABILITIES.REPORT_READ, CAPABILITIES.REPORT_MANAGE]);
    expect(may(managingCustom, AUTHORIZATION_ACTIONS.REPORT_MANAGE)).toBe(true);
  });

  it('is described in the capability catalogue and gates the new-dashboard page', () => {
    expect(CAPABILITY_CATALOG[CAPABILITIES.REPORT_MANAGE]).toMatchObject({ group: 'reporting' });
    const readOnly = new Set<Capability>([CAPABILITIES.REPORT_READ]);
    const manager = new Set<Capability>([CAPABILITIES.REPORT_READ, CAPABILITIES.REPORT_MANAGE]);
    expect(canAccessPath('/reports', readOnly)).toBe(true);
    expect(canAccessPath('/reports/executive/new', readOnly)).toBe(false);
    expect(canAccessPath('/reports/executive/new', manager)).toBe(true);
  });
});
