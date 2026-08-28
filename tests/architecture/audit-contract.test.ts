import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

function isAuditCreate(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'create') {
    return false;
  }
  const model = call.expression.expression;
  return ts.isPropertyAccessExpression(model) && model.name.text === 'auditLog';
}

describe('audit contract architecture', () => {
  it('keeps all audit writes behind the centralized emitter', () => {
    const repositoryRoot = process.cwd();
    const sourceRoot = path.join(repositoryRoot, 'src');
    const violations: string[] = [];

    for (const absolutePath of ts.sys.readDirectory(sourceRoot, ['.ts', '.tsx'])) {
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
      if (relativePath === 'src/lib/audit.ts') continue;
      const text = ts.sys.readFile(absolutePath);
      if (text === undefined) continue;
      const source = ts.createSourceFile(
        absolutePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isAuditCreate(node)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          violations.push(`${relativePath}:${line}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(
      violations,
      `Audit writes must use emitAuditEvent/logAudit.\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
