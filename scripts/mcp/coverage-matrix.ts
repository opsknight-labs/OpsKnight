import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MCP_CATALOG, isMcpExecutable, mcpContractHash } from '../../src/lib/mcp/catalog';
import { MCP_HANDLERS } from '../../src/lib/mcp/operations/handlers';
import { authorize } from '../../src/lib/authorization-policy';
import { APP_ROLES } from '../../src/lib/authorization';
import { declaredRouteActions } from './route-policy';

const failures: string[] = [];
const matrix = [];
for (const operation of MCP_CATALOG) {
  const route = `src/app/api/v2${operation.path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- canonical checked-in registry only
  const source = readFileSync(route, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  const authorization = declaredRouteActions(source, operation.method.toUpperCase()).map(
    action => ({
      action,
      rolesBeforeResource: Object.fromEntries(
        APP_ROLES.map(role => [
          role,
          authorize({
            actor: {
              id: 'coverage-only',
              role,
              status: 'ACTIVE',
              teamIds: [],
              apiKey: { id: 'coverage-only', scopes: operation.requiredScopes },
            },
            action,
          }),
        ])
      ),
    })
  );
  if (isMcpExecutable(operation) && !authorization.length)
    failures.push(`Missing authorization inventory: ${operation.operationId}`);
  if (
    JSON.stringify(authorization.map(entry => entry.action)) !== JSON.stringify(operation.actions)
  )
    failures.push(`Review authorization drift: ${operation.operationId}`);
  matrix.push({ ...operation, route, authorization });
  if (hash !== operation.routeSha256) failures.push(`Review route drift: ${operation.operationId}`);
  if (mcpContractHash(operation) !== operation.contractSha256)
    failures.push(`Review contract drift: ${operation.operationId}`);
  if (isMcpExecutable(operation) !== MCP_HANDLERS.has(operation.operationId))
    failures.push(`Handler disposition mismatch: ${operation.operationId}`);
  if (!operation.reason || !operation.resourceFilter)
    failures.push(`Missing policy: ${operation.operationId}`);
  if (operation.risk === 'R3' && isMcpExecutable(operation))
    failures.push(`R3 exposure: ${operation.operationId}`);
}
const artifact = {
  schemaVersion: 1,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
  ),
  classified: MCP_CATALOG.length,
  executableCandidates: MCP_CATALOG.filter(isMcpExecutable).length,
  certified: false,
  failures,
  operations: matrix,
};
process.stdout.write(JSON.stringify(artifact, null, 2) + '\n');
if (failures.length) process.exitCode = 1;
