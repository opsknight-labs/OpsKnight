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
      expect(capability.operationIds.length > 0).toBe(capability.status === 'available');
    }
  });
  it('retains explicit security and product decisions for unfinished plan areas', () => {
    for (const id of [
      'service-automation',
      'identity-lifecycle',
      'runbook-agents',
      'runbook-secrets',
      'status-management',
      'report-exports',
      'slo-management',
      'operational-settings',
    ]) {
      expect(API_CAPABILITY_CATALOG.find(capability => capability.id === id)?.status).toBe(
        'not-supported'
      );
    }
    for (const id of ['agent-protocol', 'scim', 'provider-oauth', 'sensitive-maintenance']) {
      expect(API_CAPABILITY_CATALOG.find(capability => capability.id === id)?.status).toBe(
        'restricted'
      );
    }
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
