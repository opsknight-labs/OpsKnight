import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// These routes intentionally implement protocols or response types that cannot
// use the OpsKnight JSON envelope, or still need migration in this PR. Keeping
// the inventory explicit prevents new contract bypasses from appearing.
const DIRECT_RESPONSE_ALLOWLIST = new Set([
  'src/app/api/admin/rollups/backfill/route.ts',
  'src/app/api/admin/rollups/health/route.ts',
  'src/app/api/admin/rollups/route.ts',
  'src/app/api/admin/sla-drift/route.ts',
  'src/app/api/admin/sla-performance/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/auth/reset-password/route.ts',
  'src/app/api/dashboards/[id]/route.ts',
  'src/app/api/dashboards/route.ts',
  'src/app/api/health/route.ts',
  'src/app/api/incidents/[id]/context/route.ts',
  'src/app/api/incidents/export/route.ts',
  'src/app/api/jira/webhook/route.ts',
  'src/app/api/logs/ingest/route.ts',
  'src/app/api/public-logs/route.ts',
  'src/app/api/reports/metrics/route.ts',
  'src/app/api/schedules/[id]/oncall/route.ts',
  'src/app/api/schedules/[id]/route.ts',
  'src/app/api/schedules/route.ts',
  'src/app/api/sla-definitions/[id]/route.ts',
  'src/app/api/sla-definitions/route.ts',
  'src/app/api/sla/compliance/route.ts',
  'src/app/api/sla/stream/route.ts',
  'src/app/api/slack/actions/route.ts',
  'src/app/api/slack/commands/route.ts',
  'src/app/api/slack/disconnect/route.ts',
  'src/app/api/slack/events/route.ts',
  'src/app/api/slack/oauth/callback/route.ts',
  'src/app/api/slack/oauth/route.ts',
  'src/app/api/status-page/domains/route.ts',
  'src/app/api/status-page/logo/[id]/route.ts',
  'src/app/api/status/create-default/route.ts',
  'src/app/api/status/history/route.ts',
  'src/app/api/status/route.ts',
  'src/app/api/system/vapid-public-key/route.ts',
  'src/app/api/users/[id]/avatar/route.ts',
  'src/app/api/webhooks/notifications/twilio/route.ts',
]);

function isDirectJsonResponse(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'json') {
    return false;
  }
  const owner = call.expression.expression;
  return ts.isIdentifier(owner) && (owner.text === 'NextResponse' || owner.text === 'Response');
}

describe('API response contract architecture', () => {
  it('prevents new route handlers from bypassing the centralized JSON response boundary', () => {
    const repositoryRoot = process.cwd();
    const apiRoot = path.join(repositoryRoot, 'src', 'app', 'api');
    const violations: string[] = [];

    for (const absolutePath of ts.sys.readDirectory(apiRoot, ['.ts'], undefined, ['**/route.ts'])) {
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
      if (DIRECT_RESPONSE_ALLOWLIST.has(relativePath)) continue;

      const text = ts.sys.readFile(absolutePath);
      if (text === undefined) continue;
      const source = ts.createSourceFile(
        absolutePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isDirectJsonResponse(node)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          violations.push(`${relativePath}:${line}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(
      violations,
      `JSON routes must use src/lib/api-response.ts.\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
