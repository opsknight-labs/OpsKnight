import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ALLOWED_CREATE_FILES = new Set([
  'src/lib/incidents/creation.ts',
  // Event ingestion has intentionally specialized initial-state semantics for
  // dedup locks, flapping, and resolve-before-trigger buffering.
  'src/lib/events.ts',
]);

function sourceFiles(root: string): string[] {
  return ts.sys
    .readDirectory(root, ['.ts', '.tsx'], undefined, undefined)
    .filter(file => !file.endsWith('.d.ts'));
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function isIncidentCreate(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'create') {
    return false;
  }
  const modelAccess = call.expression.expression;
  return ts.isPropertyAccessExpression(modelAccess) && modelAccess.name.text === 'incident';
}

describe('incident creation architecture', () => {
  it('keeps production incident creation behind the creation engine or event ingestion', () => {
    const repositoryRoot = process.cwd();
    const srcRoot = path.join(repositoryRoot, 'src');
    const violations: string[] = [];

    for (const absolutePath of sourceFiles(srcRoot)) {
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
      const text = ts.sys.readFile(absolutePath);
      if (text === undefined) {
        violations.push(`${relativePath}: source file could not be read`);
        continue;
      }

      if (text.includes('sideEffectPolicy')) {
        violations.push(`${relativePath}: legacy lifecycle sideEffectPolicy escape hatch is forbidden`);
      }

      if (ALLOWED_CREATE_FILES.has(relativePath)) continue;

      const source = ts.createSourceFile(
        absolutePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isIncidentCreate(node)) {
          violations.push(
            `${relativePath}:${lineOf(source, node)} directly creates an incident outside the creation boundary`
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(
      violations,
      `Incident creation must go through src/lib/incidents/creation.ts; event ingestion is the only specialized initial-state authority.\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
