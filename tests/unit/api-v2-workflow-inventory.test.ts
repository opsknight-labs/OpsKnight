/* eslint-disable security/detect-non-literal-fs-filename -- repository-owned inventory paths are constrained to the source tree */
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import inventory from '../../plans/rest-api-enterprise/workflow-inventory.json';
import progress from '../../plans/rest-api-enterprise/combined-progress.json';
import status from '../../plans/rest-api-enterprise/implementation-status.json';
import { API_CAPABILITY_CATALOG } from '@/lib/api-v2/capability-catalog';
import { V2_OPERATIONS } from '@/lib/api-v2/openapi-registry';
import { V2_MUTATION_CONTRACT } from '@/lib/api-v2/mutation-contract';

describe('enterprise workflow inventory admission checks', () => {
  it('assigns every explicit capability decision to a delivery without duplicating it', () => {
    const decisions = API_CAPABILITY_CATALOG.filter(item => !item.id.startsWith('baseline-'));
    const ids = inventory.workflows.map(item => item.capabilityId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.toSorted()).toEqual(decisions.map(item => item.id).toSorted());
    for (const workflow of inventory.workflows) {
      expect(workflow.delivery).toMatch(/^API-(1[3-9]|2[0-4])$/);
      expect(workflow.workflow.length).toBeGreaterThan(15);
      expect(workflow.requiredEvidence).toEqual(
        expect.arrayContaining([
          'authorization-negative',
          'business-parity',
          'postgres-concurrency',
          'contract-sdk',
        ])
      );
    }
  });

  it('links each workflow to implementation sources present in the candidate', () => {
    const sourceRoot = resolve('src') + sep;
    for (const workflow of inventory.workflows) {
      expect(workflow.sources.length).toBeGreaterThan(0);
      for (const source of workflow.sources) {
        expect(resolve(source.path).startsWith(sourceRoot)).toBe(true);
        expect(existsSync(source.path), source.path).toBe(true);
      }
    }
  });

  it('requires an explicit retry contract for every registered mutation', () => {
    for (const operation of V2_OPERATIONS) {
      if (operation.method === 'get') continue;
      const key = `${operation.method.toUpperCase()} /api/v2${operation.path.replace(/\{(\w+)\}/g, '[$1]')}`;
      const contract = Object.entries(V2_MUTATION_CONTRACT).find(
        ([candidate]) => candidate === key
      )?.[1];
      expect(contract, key).toBeDefined();
      if (contract?.preconditionRequired) expect(contract.concurrency, key).toBe('etag');
    }
  });

  it('keeps reported operation counts and automation delivery synchronized with shipped routes', () => {
    const automation = V2_OPERATIONS.filter(operation =>
      operation.path.split('/').includes('automation')
    )
      .map(operation => operation.operationId)
      .sort();
    expect(progress.registeredOperationCount).toBe(V2_OPERATIONS.length);
    expect([...progress.implementedOperations].sort()).toEqual(automation);
    expect(status.registeredOperationCount).toBe(V2_OPERATIONS.length);
    expect(status.followupDelivery.registeredOperationCount).toBe(V2_OPERATIONS.length);
    expect([...status.followupDelivery.implementedAutomationOperations].sort()).toEqual(automation);
    const workflow = inventory.workflows.find(item => item.capabilityId === 'service-automation');
    expect([...(workflow?.implementedOperations ?? [])].sort()).toEqual(automation);
  });

  it('does not infer enterprise certification from available routes', () => {
    expect(inventory.releaseGates).toHaveLength(8);
    expect(new Set(inventory.releaseGates.map(gate => gate.id)).size).toBe(8);
    for (const gate of inventory.releaseGates) {
      expect(['pending', 'passed', 'failed']).toContain(gate.status);
      if (gate.status === 'passed') expect(gate.evidence.length).toBeGreaterThan(0);
    }
    if (inventory.releaseStatus === 'certified') {
      expect(inventory.releaseGates.every(gate => gate.status === 'passed')).toBe(true);
    }
    expect(
      inventory.workflows.find(item => item.capabilityId === 'slo-management')?.blockers.length
    ).toBeGreaterThan(0);
  });
});
