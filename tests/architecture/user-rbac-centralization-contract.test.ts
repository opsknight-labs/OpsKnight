import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('user and RBAC final centralization contract', () => {
  it('keeps user lifecycle orchestration behind the user domain module', () => {
    const actions = read('src/app/(app)/users/actions.ts');
    const lifecycle = read('src/lib/users/lifecycle.ts');

    expect(actions).toContain("from '@/lib/users/lifecycle'");
    expect(actions).not.toContain("from '@/lib/users/admin-invariants'");
    expect(actions).not.toContain("from 'crypto'");
    expect(actions).not.toContain('updateUserSecurityState(');
    expect(actions).not.toContain('bulkUpdateUserSecurityState(');

    expect(lifecycle).toContain('export async function createInvitedUser(');
    expect(lifecycle).toContain('export async function rotateUserInvite(');
    expect(lifecycle).toContain('export async function deactivateUserAccount(');
    expect(lifecycle).toContain('export async function deactivateUserAccounts(');
    expect(lifecycle).toContain('export async function reactivateUserAccount(');
    expect(lifecycle).toContain('export async function deleteUserAccount(');
    expect(lifecycle).toContain('export async function updateUserRoleAccount(');
    expect(lifecycle).toContain('export async function updateUserRoleAccounts(');
  });

  it('checks hard-delete dependencies inside the deletion transaction', () => {
    const lifecycle = read('src/lib/users/lifecycle.ts');
    const dependencies = read('src/lib/users/dependencies.ts');

    expect(lifecycle).toContain('runSerializableTransaction(async tx =>');
    expect(lifecycle).toContain('discoverUserDependenciesInTransaction(tx, userId)');
    expect(dependencies).toContain('export async function discoverUserDependenciesInTransaction(');
  });

  it('uses one operational-user eligibility primitive for schedules and team leads', () => {
    const eligibility = read('src/lib/users/operational-eligibility.ts');
    const schedules = read('src/lib/schedules/mutations.ts');
    const teams = read('src/app/(app)/teams/actions.ts');

    expect(eligibility).toContain('export async function requireOperationalUser(');
    expect(schedules).toContain("from '@/lib/users/operational-eligibility'");
    expect(schedules).not.toContain('function requireActiveResponder(');
    expect(teams).toContain('requireOperationalUser(tx, teamLeadId');
    expect(teams).toContain('Team lead must be an active team member.');
  });

  it('keeps protected HTTP boundaries off raw NextAuth session authorization', () => {
    const protectedBoundaries = [
      'src/app/api/metrics/route.ts',
      'src/app/api/dashboards/route.ts',
      'src/app/api/dashboards/[id]/route.ts',
      'src/app/api/widgets/data/route.ts',
      'src/app/api/widgets/stream/route.ts',
      'src/app/api/sidebar-stats/route.ts',
      'src/app/api/notifications/route.ts',
      'src/app/api/notifications/history/route.ts',
      'src/app/api/notifications/stream/route.ts',
      'src/app/api/integrations/health/route.ts',
      'src/app/api/reports/metrics/route.ts',
      'src/app/api/sla/compliance/route.ts',
      'src/app/api/sla/stream/route.ts',
      'src/app/api/incidents/export/route.ts',
      'src/app/api/mobile/incidents/[id]/status/route.ts',
      'src/app/api/user/push-subscription/route.ts',
      'src/app/api/search/route.ts',
      'src/app/api/settings/custom-fields/route.ts',
      'src/app/api/settings/custom-fields/[id]/route.ts',
      'src/app/(app)/system-logs/page.tsx',
      'src/app/(public)/logs/page.tsx',
      'src/app/(app)/settings/api-keys/page.tsx',
      'src/app/(app)/events/page.tsx',
      'src/app/(mobile)/m/layout.tsx',
      'src/app/(mobile)/m/more/page.tsx',
    ];

    for (const path of protectedBoundaries) {
      expect(read(path), `${path} must use current-user/RBAC guards`).not.toContain('getServerSession');
    }
  });

  it('revalidates authorization for long-lived user streams', () => {
    for (const path of [
      'src/app/api/events/stream/route.ts',
      'src/app/api/widgets/stream/route.ts',
      'src/app/api/notifications/stream/route.ts',
    ]) {
      const source = read(path);
      expect(source).toContain('resolveStreamAuthorization');
      expect(source).toContain('authorization_revoked');
    }
  });

  it('uses the canonical incident scope for shared navigation/status surfaces', () => {
    const sidebar = read('src/app/api/sidebar-stats/route.ts');
    const appLayout = read('src/app/(app)/layout.tsx');
    const mobileLayout = read('src/app/(mobile)/m/layout.tsx');

    for (const source of [sidebar, appLayout, mobileLayout]) {
      expect(source).toContain('incidentReadWhere');
      expect(source).toContain('resolveUserActor');
    }
  });

  it('uses capability checks for user administration views instead of interpreting ADMIN inline', () => {
    const desktop = read('src/app/(app)/users/[id]/page.tsx');
    const mobile = read('src/app/(mobile)/m/users/[id]/page.tsx');

    expect(desktop).toContain('hasCapability(viewer.role, CAPABILITIES.ADMIN_MANAGE)');
    expect(desktop).not.toContain("viewer.role !== 'ADMIN'");
    expect(mobile).toContain('hasCapability(viewer.role, CAPABILITIES.ADMIN_MANAGE)');
    expect(mobile).not.toContain("viewer.role !== 'ADMIN'");
  });

  it('keeps status-page authenticated mode on current user validation', () => {
    for (const path of [
      'src/app/api/status/route.ts',
      'src/app/api/status/history/route.ts',
      'src/app/api/status/uptime-export/route.ts',
    ]) {
      expect(read(path)).toContain('getCurrentUser');
    }
  });
});
