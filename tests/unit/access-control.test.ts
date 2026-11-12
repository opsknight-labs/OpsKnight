/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection -- reads repository source files by computed path */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  APP_ROLES,
  CAPABILITIES,
  NON_DELEGABLE_CAPABILITIES,
  getRoleCapabilities,
  hasCapability,
  type AppRole,
} from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  incidentOperatorRelation,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';
import { resolveEffectiveAccess } from '@/lib/access/effective';
import { CAPABILITY_CATALOG, describeRequirement, groupCapabilities } from '@/lib/access/catalog';
import { PAGE_ACCESS, canAccessPath, resolvePageAccess } from '@/lib/access/pages';
import { getAuthorizedNavItems } from '@/config/navigation';

const ROLE_ORDER: AppRole[] = ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN'];

function actor(role: AppRole, overrides: Partial<AuthorizationActor> = {}): AuthorizationActor {
  return { id: 'u-1', role, status: 'ACTIVE', teamIds: ['team-a'], ...overrides };
}

type IncidentResource = Extract<AuthorizationResource, { type: 'incident' }>;
const incident = (overrides: Partial<IncidentResource> = {}): IncidentResource => ({
  type: 'incident',
  id: 'inc-1',
  assigneeId: null,
  watcherIds: [],
  visibility: 'PUBLIC',
  serviceTeamId: 'team-z',
  assignedTeamId: null,
  ...overrides,
});

describe('role capability matrix', () => {
  it('matches the reviewed snapshot (any change here is a permission change)', () => {
    const matrix = Object.fromEntries(
      APP_ROLES.map(role => [role, [...getRoleCapabilities(role)].sort()])
    );
    expect(matrix).toMatchSnapshot();
  });

  it('gives Admin every capability and nobody else administration', () => {
    for (const capability of Object.values(CAPABILITIES)) {
      expect(hasCapability('ADMIN', capability)).toBe(true);
    }
    for (const role of ['USER', 'AUDITOR', 'RESPONDER'] as AppRole[]) {
      expect(hasCapability(role, CAPABILITIES.ADMIN_MANAGE)).toBe(false);
      expect(hasCapability(role, CAPABILITIES.ACCESS_REVIEW_MANAGE)).toBe(false);
    }
  });

  it('keeps Auditor strictly read-only', () => {
    for (const capability of getRoleCapabilities('AUDITOR')) {
      expect(capability).not.toMatch(
        /manage|edit|publish|execute|approve|erasure|create|acknowledge|resolve|escalate|note/
      );
    }
  });
});

describe('capability catalog', () => {
  it('describes every capability', () => {
    for (const capability of Object.values(CAPABILITIES)) {
      expect(CAPABILITY_CATALOG[capability]?.label, capability).toBeTruthy();
    }
  });

  it('turns requirements into plain language from the enforced roles', () => {
    expect(describeRequirement(CAPABILITIES.AUDIT_READ).summary).toBe('Requires Auditor or Admin');
    expect(describeRequirement(CAPABILITIES.RUNBOOK_EXECUTE).rolesText).toBe('Responder or Admin');
    expect(describeRequirement(CAPABILITIES.ADMIN_MANAGE).summary).toBe('Requires Admin');
    expect(
      describeRequirement([CAPABILITIES.INCIDENT_READ_ALL, CAPABILITIES.INCIDENT_READ_SCOPED]).roles
    ).toEqual(ROLE_ORDER);
  });

  it('groups capabilities for display without losing any', () => {
    const all = getRoleCapabilities('ADMIN');
    const grouped = groupCapabilities(all).flatMap(group =>
      group.items.map(item => item.capability)
    );
    expect(new Set(grouped)).toEqual(new Set(all));
  });
});

describe('scoped incident operations', () => {
  const operatorActions = [
    AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
    AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
    AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE,
    AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE,
  ];

  it.each(operatorActions)('lets a USER %s an incident assigned to them', action => {
    expect(
      authorize({ actor: actor('USER'), action, resource: incident({ assigneeId: 'u-1' }) }).allowed
    ).toBe(true);
  });

  it.each(operatorActions)('lets a USER %s an incident on their team’s service', action => {
    const resource = incident({ serviceTeamId: 'team-a' });
    expect(authorize({ actor: actor('USER'), action, resource }).allowed).toBe(true);
  });

  it.each(operatorActions)('lets a USER %s an incident that pages them', action => {
    const resource = incident({ onCallUserIds: ['u-1'] });
    expect(authorize({ actor: actor('USER'), action, resource }).allowed).toBe(true);
  });

  it.each(operatorActions)('denies a USER %s on an unrelated incident', action => {
    const decision = authorize({ actor: actor('USER'), action, resource: incident() });
    expect(decision).toMatchObject({ allowed: false, reason: 'RESOURCE_OUT_OF_SCOPE' });
  });

  it('lets watchers read but not operate', () => {
    const resource = incident({ watcherIds: ['u-1'] });
    expect(
      authorize({ actor: actor('USER'), action: AUTHORIZATION_ACTIONS.INCIDENT_READ, resource })
        .allowed
    ).toBe(true);
    expect(
      authorize({
        actor: actor('USER'),
        action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
        resource,
      }).allowed
    ).toBe(false);
    expect(incidentOperatorRelation(actor('USER'), resource)).toBeNull();
  });

  it('does not let team membership operate a private incident', () => {
    const resource = incident({ serviceTeamId: 'team-a', visibility: 'PRIVATE' });
    expect(
      authorize({ actor: actor('USER'), action: AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE, resource })
        .allowed
    ).toBe(false);
  });

  it('keeps urgency, reassignment and other management with Responders and Admins', () => {
    const resource = incident({ assigneeId: 'u-1' });
    expect(
      authorize({ actor: actor('USER'), action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE, resource })
        .allowed
    ).toBe(false);
    expect(
      authorize({
        actor: actor('RESPONDER'),
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        resource: incident(),
      }).allowed
    ).toBe(true);
  });

  it('never lets an Auditor operate, even when assigned', () => {
    const resource = incident({ assigneeId: 'u-1', serviceTeamId: 'team-a' });
    for (const action of operatorActions) {
      expect(authorize({ actor: actor('AUDITOR'), action, resource }).allowed).toBe(false);
    }
  });

  it('honours an incident-scoped emergency grant for that incident only', () => {
    const elevated = actor('USER', { elevatedIncidentIds: ['inc-1'] });
    expect(
      authorize({
        actor: elevated,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        resource: incident(),
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: elevated,
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        resource: incident({ id: 'inc-2' }),
      }).allowed
    ).toBe(false);
  });

  it('respects API key scopes before relationships', () => {
    const keyActor = actor('USER', { apiKey: { id: 'k', scopes: ['incidents:read'] } });
    const decision = authorize({
      actor: keyActor,
      action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
      resource: incident({ assigneeId: 'u-1' }),
    });
    expect(decision).toMatchObject({ allowed: false, reason: 'MISSING_SCOPE' });
  });
});

describe('effective access (custom roles, grants, policy)', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  const later = new Date('2026-11-12T11:00:00Z');
  const earlier = new Date('2026-11-12T09:00:00Z');

  it('adds custom-role permissions but never administration', () => {
    const access = resolveEffectiveAccess(
      {
        role: 'AUDITOR',
        customRole: {
          id: 'cr',
          name: 'Runbook operator',
          capabilities: ['runbook.execute', 'admin.manage', 'access.review.manage', 'not.real'],
          archivedAt: null,
        },
      },
      undefined,
      now
    );
    expect(access.capabilities.has(CAPABILITIES.RUNBOOK_EXECUTE)).toBe(true);
    for (const capability of NON_DELEGABLE_CAPABILITIES) {
      expect(access.capabilities.has(capability)).toBe(false);
    }
    expect(access.role).toBe('AUDITOR');
    expect(access.customRole?.name).toBe('Runbook operator');
  });

  it('ignores archived custom roles', () => {
    const access = resolveEffectiveAccess(
      {
        role: 'USER',
        customRole: { id: 'cr', name: 'x', capabilities: ['runbook.execute'], archivedAt: earlier },
      },
      undefined,
      now
    );
    expect(access.capabilities.has(CAPABILITIES.RUNBOOK_EXECUTE)).toBe(false);
    expect(access.customRole).toBeNull();
  });

  it('raises the effective role for active org-wide grants and ignores expired or revoked ones', () => {
    const access = resolveEffectiveAccess(
      {
        role: 'USER',
        accessGrants: [
          { id: 'g1', role: 'RESPONDER', incidentId: null, expiresAt: later },
          { id: 'g2', role: 'ADMIN', incidentId: null, expiresAt: earlier },
          { id: 'g3', role: 'ADMIN', incidentId: null, expiresAt: later, revokedAt: earlier },
        ],
      },
      undefined,
      now
    );
    expect(access.baseRole).toBe('USER');
    expect(access.role).toBe('RESPONDER');
    expect(access.capabilities.has(CAPABILITIES.OPERATIONS_MANAGE)).toBe(true);
    expect(access.capabilities.has(CAPABILITIES.ADMIN_MANAGE)).toBe(false);
    expect(access.activeGrants.map(grant => grant.id)).toEqual(['g1']);
  });

  it('keeps incident-scoped grants off the org-wide role', () => {
    const access = resolveEffectiveAccess(
      {
        role: 'USER',
        accessGrants: [{ id: 'g', role: 'RESPONDER', incidentId: 'inc-9', expiresAt: later }],
      },
      undefined,
      now
    );
    expect(access.role).toBe('USER');
    expect(access.capabilities.has(CAPABILITIES.OPERATIONS_MANAGE)).toBe(false);
    expect(access.elevatedIncidentIds).toEqual(['inc-9']);
  });

  it('removes scoped incident operations when the organization turns them off', () => {
    const off = resolveEffectiveAccess(
      { role: 'USER' },
      { userIncidentActionsEnabled: false },
      now
    );
    expect(off.capabilities.has(CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED)).toBe(false);
    expect(off.capabilities.has(CAPABILITIES.INCIDENT_READ_SCOPED)).toBe(true);
    const responder = resolveEffectiveAccess(
      { role: 'RESPONDER' },
      { userIncidentActionsEnabled: false },
      now
    );
    expect(responder.capabilities.has(CAPABILITIES.OPERATIONS_MANAGE)).toBe(true);
  });
});

describe('page access registry', () => {
  it('prefers literal segments over parameters', () => {
    expect(resolvePageAccess('/incidents/create')?.label).toBe('Create incident');
    expect(resolvePageAccess('/incidents/clx123')?.label).toBe('Incident');
    expect(resolvePageAccess('/settings/system/emergency')?.anyOf).toBeUndefined();
    expect(resolvePageAccess('/settings/system/health')?.anyOf).toEqual([
      CAPABILITIES.ADMIN_MANAGE,
    ]);
  });

  it('maps mobile routes to their desktop rules', () => {
    expect(resolvePageAccess('/m/users')?.pattern).toBe('/users');
    expect(resolvePageAccess('/m/incidents/abc')?.pattern).toBe('/incidents/[id]');
  });

  it.each([
    ['/audit', ['AUDITOR', 'ADMIN']],
    ['/users', ['AUDITOR', 'RESPONDER', 'ADMIN']],
    ['/runbooks', ['AUDITOR', 'RESPONDER', 'ADMIN']],
    ['/runbooks/agents/secrets', ['ADMIN']],
    ['/settings/security-compliance', ['AUDITOR', 'ADMIN']],
    ['/settings/integrations/slack', ['ADMIN']],
    ['/settings/integrations/mcp', ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN']],
    ['/incidents', ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN']],
    ['/incidents/create', ['RESPONDER', 'ADMIN']],
    ['/system-logs', ['ADMIN']],
    ['/settings/access', ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN']],
    ['/settings/access/admin', ['ADMIN']],
  ])('%s is open to %j', (route, allowed) => {
    const open = ROLE_ORDER.filter(role => canAccessPath(route, getRoleCapabilities(role)));
    expect(open).toEqual(allowed);
  });

  it('builds the sidebar from the registry', () => {
    const labels = (role: AppRole) =>
      getAuthorizedNavItems(getRoleCapabilities(role)).map(item => item.href);
    expect(labels('USER')).not.toContain('/audit');
    expect(labels('USER')).not.toContain('/users');
    expect(labels('USER')).toContain('/incidents');
    expect(labels('AUDITOR')).toContain('/audit');
    expect(labels('RESPONDER')).not.toContain('/audit');
    expect(labels('ADMIN')).toContain('/events');
    expect(getAuthorizedNavItems(null)).toEqual([]);
    // Legacy role-string callers still work.
    expect(getAuthorizedNavItems('AUDITOR').map(item => item.href)).toContain('/audit');
  });

  it('only grants via capabilities that exist', () => {
    const known = new Set<string>(Object.values(CAPABILITIES));
    for (const rule of PAGE_ACCESS) {
      for (const capability of rule.anyOf ?? [])
        expect(known.has(capability), rule.pattern).toBe(true);
    }
  });
});

// ─── Contract: every page is registered and guarded ─────────────────────────

const APP_ROOT = path.join(process.cwd(), 'src/app/(app)');
const MOBILE_ROOT = path.join(process.cwd(), 'src/app/(mobile)/m');

function pageFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

function routeFor(root: string, file: string, prefix = ''): string {
  const relative = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
  const segments = relative.filter(segment => !segment.startsWith('('));
  return `${prefix}/${segments.join('/')}`.replace(/\/$/, '') || '/';
}

describe('page access contract', () => {
  const pages = [
    ...pageFiles(APP_ROOT).map(file => ({ file, route: routeFor(APP_ROOT, file) })),
    ...pageFiles(MOBILE_ROOT).map(file => ({ file, route: routeFor(MOBILE_ROOT, file, '/m') })),
  ];

  it('finds the application pages', () => {
    expect(pages.length).toBeGreaterThan(80);
  });

  it.each(pages.map(page => [page.route, page.file]))('%s has an explicit access rule', route => {
    const rule = resolvePageAccess(route);
    expect(rule, `Add ${route} to PAGE_ACCESS in src/lib/access/pages.ts`).toBeDefined();
    // Only the dashboard itself may rely on the root rule; everything else must be registered.
    const desktopRoute = route.replace(/^\/m(?=\/|$)/, '') || '/';
    const rootOnly = rule!.pattern === '/' && desktopRoute !== '/';
    const mobileOnly =
      route.startsWith('/m/') &&
      ['/m/status', '/m/more', '/m/notifications'].some(
        prefix => route === prefix || route.startsWith(`${prefix}/`)
      );
    expect(rootOnly && !mobileOnly, `Add ${desktopRoute} to PAGE_ACCESS`).toBe(false);
  });

  it.each(pages.map(page => [page.route, page.file]))(
    '%s enforces its rule on the server',
    (_route, file) => {
      const source = readFileSync(file as string, 'utf8');
      const isClient = /^\s*['"]use client['"]/.test(source);
      const isRedirectOnly =
        /permanentRedirect\(|^\s*redirect\(/m.test(source) && !/export default async/.test(source);
      if (isClient) {
        const layout = path.join(path.dirname(file as string), 'layout.tsx');
        const guardedByLayout = (() => {
          try {
            return readFileSync(layout, 'utf8').includes('requirePageAccess');
          } catch {
            return false;
          }
        })();
        const rule = resolvePageAccess(_route as string);
        expect(guardedByLayout || !rule?.anyOf?.length, `${file} needs a guarding layout`).toBe(
          true
        );
        return;
      }
      if (isRedirectOnly) return;
      expect(
        source.includes(`requirePageAccess('${_route}')`) ||
          source.includes(`requirePageAccessSnapshot('${_route}')`),
        `${file} must call requirePageAccess('${_route}')`
      ).toBe(true);
    }
  );
});

// ─── Ratchet: no new hard-coded role checks in UI code ──────────────────────

const ROLE_CHECK =
  /\brole\s*[!=]==\s*['"](ADMIN|RESPONDER|AUDITOR|USER)['"]|['"](ADMIN|RESPONDER|AUDITOR|USER)['"]\s*[!=]==\s*\w*\.?role\b/g;
// Inline role checks drift from server enforcement; use capabilities (`useCan`, `<PermissionGate>`,
// `capabilitiesOf`) instead. Lower this number as files are migrated; never raise it.
const ROLE_CHECK_BASELINE = Number(
  JSON.parse(readFileSync(path.join(__dirname, 'access-role-check-baseline.json'), 'utf8')).count
);

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = path.join(root, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('inline role-check ratchet', () => {
  it('does not add hard-coded role comparisons to UI code', () => {
    const roots = ['src/components', 'src/app'].map(root => path.join(process.cwd(), root));
    const count = roots
      .flatMap(sourceFiles)
      .reduce(
        (total, file) => total + (readFileSync(file, 'utf8').match(ROLE_CHECK)?.length ?? 0),
        0
      );
    expect(count, 'Use capabilities instead of role comparisons').toBeLessThanOrEqual(
      ROLE_CHECK_BASELINE
    );
  });
});
