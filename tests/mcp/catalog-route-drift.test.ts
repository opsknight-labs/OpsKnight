import { createHash } from 'node:crypto';
import { readFileSync as fsRead } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declaredRouteActions } from '../../scripts/mcp/route-policy';
import { MCP_CATALOG, isMcpExecutable } from '@/lib/mcp/catalog';

// Canonical checked-in REST route files only, derived from the catalog's own paths.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- catalog route paths only
const readRoute = (path: string) => fsRead(path, 'utf8');

const REVIEW =
  'Re-review this operation and update routeSha256/actions in src/lib/mcp/catalog/review.json';

/**
 * CERT-01: the coverage gate only runs in the MCP workflow, whose path filter a REST route change
 * can miss. This runs on every PR (unit suite, no database) and fails the moment a route that an
 * MCP operation depends on changes its source or its mandatory authorization actions.
 */
describe('MCP catalog route drift', () => {
  it.each(MCP_CATALOG.map(operation => [operation.operationId, operation] as const))(
    '%s still matches its reviewed route',
    (operationId, operation) => {
      const route = `src/app/api/v2${operation.path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`;
      const source = readRoute(route);
      expect(createHash('sha256').update(source).digest('hex'), `${operationId}: ${REVIEW}`).toBe(
        operation.routeSha256
      );
      const actions = declaredRouteActions(source, operation.method.toUpperCase());
      expect(actions, `${operationId}: ${REVIEW}`).toEqual(operation.actions);
      if (isMcpExecutable(operation)) expect(actions.length, operationId).toBeGreaterThan(0);
    }
  );
});
