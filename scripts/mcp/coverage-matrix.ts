import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  MCP_CATALOG,
  isMcpApprovalGated,
  isMcpExecutable,
  isMcpSideEffectFreeRead,
  mcpContractHash,
} from '../../src/lib/mcp/catalog';
import {
  MCP_APPROVAL_HANDLERS,
  MCP_HANDLERS,
  MCP_PREVIEW_HANDLERS,
} from '../../src/lib/mcp/operations/handlers';
import { authorize } from '../../src/lib/authorization-policy';
import { APP_ROLES } from '../../src/lib/authorization';
import { declaredRouteActions } from './route-policy';
import { buildMcpParityReport } from '../../src/lib/mcp/catalog/parity';

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
  if (isMcpApprovalGated(operation) !== MCP_APPROVAL_HANDLERS.has(operation.operationId))
    failures.push(`Approval handler disposition mismatch: ${operation.operationId}`);
  if (isMcpApprovalGated(operation) && isMcpExecutable(operation))
    failures.push(`Approval-gated operation is generically executable: ${operation.operationId}`);
  // A natural (receipt-less) write qualifies only when its transaction runs the approval hook,
  // which records completion atomically with the effect.
  const naturalDelete =
    operation.mutation?.idempotency === 'natural' &&
    (source.includes('internalV2MutationGuard()?.(tx)') ||
      source.includes('runV2AuditedMutation('));
  if (
    isMcpApprovalGated(operation) &&
    !['required', 'supported'].includes(operation.mutation?.idempotency ?? '') &&
    !naturalDelete
  )
    failures.push(`Approval-gated operation is not replay-safe: ${operation.operationId}`);
  if (isMcpApprovalGated(operation) && operation.risk === 'R3') {
    const preview = MCP_CATALOG.find(item => item.operationId === operation.impactPreview);
    const names = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    if (
      !preview ||
      preview.method !== 'get' ||
      !MCP_PREVIEW_HANDLERS.has(preview.operationId) ||
      !names(preview.path).every(name => names(operation.path).includes(name))
    )
      failures.push(
        `Destructive approval without a valid impact preview: ${operation.operationId}`
      );
    else if (!preview.requiredScopes.every(scope => operation.requiredScopes.includes(scope)))
      failures.push(`Destructive approval cannot read its own preview: ${operation.operationId}`);
  }
  if (MCP_PREVIEW_HANDLERS.has(operation.operationId) && operation.method !== 'get')
    failures.push(`Preview handler is not a read: ${operation.operationId}`);
  if (!operation.reason || !operation.resourceFilter)
    failures.push(`Missing policy: ${operation.operationId}`);
  if (operation.status === 'SENSITIVE_READ' && !isMcpSideEffectFreeRead(operation))
    failures.push(`Sensitive read is not a read: ${operation.operationId}`);
  if (
    ['R2', 'R3', 'R4'].includes(operation.risk) &&
    isMcpExecutable(operation) &&
    !(operation.status === 'SENSITIVE_READ' && operation.risk === 'R2')
  )
    failures.push(`Sensitive generic exposure: ${operation.operationId}`);
}
const parity = buildMcpParityReport(MCP_CATALOG);
const artifact = {
  schemaVersion: 1,
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
  ),
  classified: MCP_CATALOG.length,
  executableCandidates: MCP_CATALOG.filter(isMcpExecutable).length,
  certified: false,
  parity,
  failures,
  operations: matrix,
};
process.stdout.write(JSON.stringify(artifact, null, 2) + '\n');
if (
  failures.length ||
  (process.argv.includes('--require-full-parity') && !parity.implementationComplete)
)
  process.exitCode = 1;
