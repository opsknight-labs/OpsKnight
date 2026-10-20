import { describe, expect, it } from 'vitest';
import { API_CAPABILITY_CATALOG } from '@/lib/api-v2/capability-catalog';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '@/lib/api-v2/mutation-contract';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';

describe('truthful capability inventory', () => {
  it('covers every shipped operation without inventing placeholder routes', () => {
    const declared = new Set(
      API_CAPABILITY_CATALOG.flatMap(capability => [...capability.operationIds])
    );
    const shipped = new Set(V2_OPERATIONS.map(operation => operation.operationId));
    expect([...declared].sort()).toEqual([...shipped].sort());
    expect(new Set(API_CAPABILITY_CATALOG.map(capability => capability.id)).size).toBe(
      API_CAPABILITY_CATALOG.length
    );
    for (const capability of API_CAPABILITY_CATALOG) {
      expect(capability.explanation.length).toBeGreaterThan(30);
      expect(capability.operationIds.length > 0).toBe(
        ['available', 'partial'].includes(capability.status)
      );
    }
  });
  it('retains explicit security and product decisions for unfinished plan areas', () => {
    for (const id of ['operational-settings']) {
      expect(API_CAPABILITY_CATALOG.find(capability => capability.id === id)?.status).toBe(
        'not-supported'
      );
    }
    expect(API_CAPABILITY_CATALOG.find(capability => capability.id === 'report-exports')).toMatchObject({
      status: 'partial',
      operationIds: expect.arrayContaining(['createReportExport', 'downloadReportExport']),
    });
    expect(
      API_CAPABILITY_CATALOG.find(capability => capability.id === 'identity-lifecycle')
    ).toMatchObject({
      status: 'partial',
      operationIds: [
        'getUserAdministration',
        'getUserDependencies',
        'administerUser',
        'getUserInvitationPolicy',
        'createUserInvitation',
        'getUserInvitation',
        'renewUserInvitation',
      ],
    });
    for (const id of ['runbook-agents', 'runbook-secrets']) {
      expect(API_CAPABILITY_CATALOG.find(capability => capability.id === id)?.status).toBe(
        'partial'
      );
    }
    expect(
      API_CAPABILITY_CATALOG.find(capability => capability.id === 'slo-management')
    ).toMatchObject({
      status: 'partial',
      operationIds: expect.arrayContaining([
        'createServiceObjective',
        'evaluateServiceObjective',
        'getServiceObjectiveHistory',
      ]),
    });
    expect(
      API_CAPABILITY_CATALOG.find(capability => capability.id === 'service-automation')
    ).toMatchObject({
      status: 'partial',
      operationIds: expect.arrayContaining(['getAutomationDraft', 'publishAutomationVersion']),
    });
    expect(
      API_CAPABILITY_CATALOG.find(capability => capability.id === 'status-management')
    ).toMatchObject({
      status: 'partial',
      operationIds: expect.arrayContaining([
        'listStatusPageSubscribers',
        'removeStatusPageSubscriber',
        'getStatusPageContent',
        'updateStatusPagePrivacy',
        'setStatusPageServices',
      ]),
    });
    for (const id of ['agent-protocol', 'scim', 'provider-oauth', 'sensitive-maintenance']) {
      expect(API_CAPABILITY_CATALOG.find(capability => capability.id === id)?.status).toBe(
        'restricted'
      );
    }
  });
  it('keeps publication identity separate from the draft validator', () => {
    const spec = getOpenApiV2Spec() as {
      paths: Record<
        string,
        Record<string, { responses: Record<string, { headers?: Record<string, unknown> }> }>
      >;
    };
    expect(
      spec.paths['/services/{id}/automation/publish'].post.responses['200'].headers?.ETag
    ).toBeUndefined();
  });
  it('documents required preconditions and their error statuses', () => {
    const spec = getOpenApiV2Spec() as {
      paths: Record<
        string,
        Record<
          string,
          {
            parameters: { name: string; required?: boolean }[];
            responses: Record<string, unknown>;
          }
        >
      >;
    };
    for (const [key, contract] of Object.entries(V2_MUTATION_CONTRACT)) {
      if (!contract.preconditionRequired) continue;
      const [method, path] = key.split(' ');
      const operation =
        spec.paths[path.replace('/api/v2', '').replace(/\[(\w+)\]/g, '{$1}')][method.toLowerCase()];
      expect(operation.parameters.find(parameter => parameter.name === 'If-Match')?.required).toBe(
        true
      );
      expect(operation.responses['428']).toBeDefined();
      expect(operation.responses['412']).toBeDefined();
    }
  });
});
