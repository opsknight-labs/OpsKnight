import { describe, expect, it } from 'vitest';
import {
  mapArgoCdChange,
  mapLaunchDarklyChange,
  mapTerraformChange,
  mapUnleashChange,
} from '@/lib/intelligence/changes/mappers';
import { normalizeEntityRef, parseCatalog } from '@/lib/intelligence/dependencies/import';
import { renderHandoffSummary } from '@/lib/intelligence/handoff/summary';
import {
  scoreAlertQuality,
  summarizeAlertQualityByTeam,
} from '@/lib/intelligence/triage/alert-quality';

describe('native change-source mappers', () => {
  it('records finished Argo CD syncs as deploys and ignores in-flight ones', () => {
    const payload = {
      app: {
        metadata: { name: 'checkout', namespace: 'argocd', labels: { environment: 'prod' } },
        spec: { project: 'shop', destination: { name: 'prod-eu' } },
        status: {
          sync: { status: 'Synced', revision: 'abcdef1234567890' },
          operationState: { phase: 'Succeeded', finishedAt: '2026-11-07T10:00:00Z' },
        },
      },
    };
    expect(mapArgoCdChange(payload)).toMatchObject({
      source: 'argocd',
      kind: 'DEPLOY',
      component: 'checkout',
      version: 'abcdef1234567890',
      dedupKey: 'checkout:abcdef1234567890:2026-11-07T10:00:00Z',
      occurredAt: '2026-11-07T10:00:00Z',
      labels: { environment: 'prod', project: 'shop', cluster: 'prod-eu', phase: 'Succeeded' },
    });
    expect(
      mapArgoCdChange({
        app: { metadata: { name: 'x' }, status: { operationState: { phase: 'Running' } } },
      })
    ).toBeNull();
    expect(mapArgoCdChange({})).toBeNull();
  });

  it('maps LaunchDarkly flag audit entries and skips non-flag kinds', () => {
    const change = mapLaunchDarklyChange({
      _id: 'audit-1',
      kind: 'flag',
      name: 'new-checkout',
      title: 'Alice turned on the flag new-checkout in Production',
      titleVerb: 'turned on',
      date: 1_762_500_000_000,
      member: { email: 'alice@example.com' },
      accesses: [{ action: 'updateOn', resource: 'proj/shop:env/production:flag/new-checkout' }],
      _links: {
        site: { href: 'https://app.launchdarkly.com/shop/production/features/new-checkout' },
      },
    });
    expect(change).toMatchObject({
      source: 'launchdarkly',
      kind: 'FEATURE_FLAG',
      component: 'new-checkout',
      dedupKey: 'audit-1',
      occurredAt: 1_762_500_000_000,
      labels: {
        project: 'shop',
        environment: 'production',
        action: 'updateOn',
        actor: 'alice@example.com',
      },
    });
    expect(mapLaunchDarklyChange({ kind: 'project', name: 'x' })).toBeNull();
  });

  it('maps Unleash toggle events and drops read-only events', () => {
    expect(
      mapUnleashChange({
        id: 42,
        type: 'feature-environment-enabled',
        featureName: 'dark-mode',
        environment: 'production',
        project: 'default',
        createdBy: 'bob',
        createdAt: '2026-11-07T09:30:00.000Z',
      })
    ).toMatchObject({
      source: 'unleash',
      kind: 'FEATURE_FLAG',
      component: 'dark-mode',
      dedupKey: '42',
      summary: 'feature environment enabled: dark-mode',
      labels: { environment: 'production', project: 'default', actor: 'bob' },
    });
    expect(mapUnleashChange({ type: 'feature-read', featureName: 'x' })).toBeNull();
  });

  it('records applied and errored Terraform runs only', () => {
    const base = {
      run_id: 'run-123',
      workspace_name: 'prod-network',
      organization_name: 'acme',
      run_message: 'Widen subnet',
      run_url: 'https://app.terraform.io/app/acme/prod-network/runs/run-123',
    };
    expect(
      mapTerraformChange({
        ...base,
        notifications: [
          { trigger: 'run:applied', run_status: 'applied', run_updated_at: '2026-11-07T08:00:00Z' },
        ],
      })
    ).toMatchObject({
      source: 'terraform',
      kind: 'INFRA',
      version: 'run-123',
      component: 'prod-network',
      dedupKey: 'run-123:applied',
      occurredAt: '2026-11-07T08:00:00Z',
    });
    expect(mapTerraformChange({ ...base, notifications: [{ run_status: 'planning' }] })).toBeNull();
    expect(
      mapTerraformChange({ ...base, notifications: [{ run_status: 'discarded' }] })
    ).toBeNull();
  });
});

describe('Backstage catalog import', () => {
  it('parses multi-document YAML and JSON arrays into dependency-bearing entities', () => {
    const yaml = `apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: checkout
  annotations:
    opsknight.com/service-id: svc-checkout
spec:
  type: service
  dependsOn:
    - component:payments
    - resource:default/orders-db
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: team-shop
---
kind: Resource
metadata:
  name: orders-db
`;
    const entities = parseCatalog(yaml);
    expect(entities.map(e => e.name)).toEqual(['checkout', 'orders-db']);
    expect(entities[0]).toMatchObject({
      serviceId: 'svc-checkout',
      dependsOn: ['component:payments', 'resource:default/orders-db'],
    });
    expect(
      parseCatalog(
        JSON.stringify([{ kind: 'Component', metadata: { name: 'a' }, spec: { dependsOn: ['b'] } }])
      )
    ).toHaveLength(1);
    expect(
      parseCatalog(JSON.stringify({ items: [{ kind: 'API', metadata: { name: 'x' } }] }))
    ).toHaveLength(1);
    expect(() => parseCatalog('')).toThrow();
    expect(() => parseCatalog('{ not json')).toThrow();
  });

  it('normalizes entity references with Backstage defaults', () => {
    expect(normalizeEntityRef('payments', 'component', 'default')).toBe(
      'component:default/payments'
    );
    expect(normalizeEntityRef('Resource:Prod/Orders-DB', 'component', 'default')).toBe(
      'resource:prod/orders-db'
    );
    expect(normalizeEntityRef('component:payments', 'component', 'shop')).toBe(
      'component:shop/payments'
    );
  });
});

describe('handoff summary rendering', () => {
  it('escapes operator text in HTML and lists the counts in the subject', () => {
    const rendered = renderHandoffSummary(
      {
        scheduleName: 'Primary <oncall>',
        generatedAt: new Date('2026-11-07T06:00:00Z'),
        open: [
          {
            id: 'i1',
            title: 'DB <down>',
            status: 'OPEN',
            urgency: 'HIGH',
            serviceName: 'db',
            ageMinutes: 95,
            assigneeName: null,
            acknowledged: false,
          },
        ],
        recentlyResolved: [
          {
            id: 'i2',
            title: 'Fixed',
            serviceName: 'api',
            resolvedAt: new Date('2026-11-07T01:00:00Z'),
          },
        ],
        overdueFollowUps: [
          {
            id: 'a1',
            title: 'Rotate certs',
            dueAt: new Date('2026-11-01T00:00:00Z'),
            incidentId: null,
          },
        ],
        counts: { open: 1, unacknowledged: 1, high: 1, resolved: 1, overdue: 1 },
        narrative: 'Look at the <database> first.',
      },
      'https://ops.example.com'
    );
    expect(rendered.subject).toBe(
      'Shift handoff for Primary <oncall>: 1 open, 1 unacknowledged, 1 high urgency'
    );
    expect(rendered.html).toContain('DB &lt;down&gt;');
    expect(rendered.html).toContain('Look at the &lt;database&gt; first.');
    expect(rendered.html).not.toContain('<down>');
    expect(rendered.text).toContain('https://ops.example.com/incidents/i1');
    expect(rendered.text).toContain('Rotate certs (due 2026-11-01)');
  });
});

describe('alert quality by team', () => {
  it('counts flapping as a noise signal and rolls services up by team', () => {
    expect(
      scoreAlertQuality({
        resolved: 10,
        quickResolved: 2,
        neverAcknowledged: 2,
        flapping: 8,
        total: 10,
      })
    ).toMatchObject({
      flappingRatio: 0.8,
      noiseScore: 0.8,
    });
    const rows = [
      {
        serviceId: 'a',
        serviceName: 'a',
        teamId: 't1',
        teamName: 'Shop',
        incidents: 10,
        quickResolvedRatio: 0.8,
        neverAcknowledgedRatio: 0.8,
        flappingRatio: 0,
        noiseScore: 0.8,
        flagged: true,
      },
      {
        serviceId: 'b',
        serviceName: 'b',
        teamId: 't1',
        teamName: 'Shop',
        incidents: 30,
        quickResolvedRatio: 0.1,
        neverAcknowledgedRatio: 0.1,
        flappingRatio: 0,
        noiseScore: 0.1,
        flagged: false,
      },
      {
        serviceId: 'c',
        serviceName: 'c',
        teamId: null,
        teamName: null,
        incidents: 5,
        quickResolvedRatio: 0.9,
        neverAcknowledgedRatio: 0.9,
        flappingRatio: 0,
        noiseScore: 0.9,
        flagged: true,
      },
    ];
    const teams = summarizeAlertQualityByTeam(rows);
    expect(teams[0]).toMatchObject({ teamName: 'No team', noiseScore: 0.9, flaggedServices: 1 });
    expect(teams[1]).toMatchObject({
      teamId: 't1',
      services: 2,
      flaggedServices: 1,
      incidents: 40,
      noiseScore: 0.275,
    });
  });
});
