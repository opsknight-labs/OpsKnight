import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MCP_OPERATION_MAP, isMcpExecutable, mcpContractHash } from '@/lib/mcp/catalog';
import { MCP_HANDLERS } from '@/lib/mcp/operations/handlers';

describe('dependency graph MCP tools', () => {
  it('exposes the four reads as curated read-only tools behind service.read', () => {
    for (const [id, tool] of [
      ['getDependencyGraphAt', 'dependency_graph_at'],
      ['getDependencyGraphDiff', 'dependency_graph_changes'],
      ['listDependencyGraphSinglePointsOfFailure', 'dependency_single_points_of_failure'],
      ['getDependencyFailureSimulation', 'dependency_failure_blast_radius'],
    ] as const) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation, id).toMatchObject({ status: 'CURATED', risk: 'R0', tool });
      expect(operation.actions, id).toEqual(['service.read']);
      expect(isMcpExecutable(operation), id).toBe(true);
      expect(MCP_HANDLERS.has(id), id).toBe(true);
    }
  });

  it('keeps writes and the embed token out of assistants', () => {
    for (const id of [
      'createDependencyGraphView',
      'updateDependencyGraphView',
      'deleteDependencyGraphView',
      'shareDependencyGraphView',
      'revokeDependencyGraphViewShare',
      'ingestDependencyEdgeStats',
    ]) {
      const operation = MCP_OPERATION_MAP.get(id)!;
      expect(operation.status, id).toBe('UNSUPPORTED_WITH_REASON');
      expect(isMcpExecutable(operation), id).toBe(false);
      expect(MCP_HANDLERS.has(id), id).toBe(false);
    }
  });

  it('pins every review to the current route source and contract', () => {
    for (const operation of MCP_OPERATION_MAP.values()) {
      if (!/Dependency(Graph|Failure|EdgeStats)/.test(operation.operationId)) continue;
      const route = `src/app/api/v2${operation.path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test reads route files derived from the in-repo operation map
      const source = readFileSync(route, 'utf8');
      expect(createHash('sha256').update(source).digest('hex'), operation.operationId).toBe(
        operation.routeSha256
      );
      expect(mcpContractHash(operation), operation.operationId).toBe(operation.contractSha256);
    }
  });
});
