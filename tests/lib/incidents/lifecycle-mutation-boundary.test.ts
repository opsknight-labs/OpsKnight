import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PROTECTED_FIELDS = new Set([
  'status',
  'acknowledgedAt',
  'resolvedAt',
  'snoozedUntil',
  'snoozeReason',
  'escalationStatus',
  'currentEscalationStep',
  'nextEscalationAt',
]);

// The lifecycle engine owns all lifecycle-sensitive mutations. The escalation
// runner is the only narrower exception: it advances escalation cursor/timing
// while an incident remains OPEN, but it may not change lifecycle status,
// acknowledgement/resolution timestamps, or snooze state.
const ALLOWED_FIELDS_BY_FILE = new Map<string, ReadonlySet<string>>([
  ['src/lib/incidents/lifecycle.ts', PROTECTED_FIELDS],
  [
    'src/lib/escalation.ts',
    new Set(['escalationStatus', 'currentEscalationStep', 'nextEscalationAt']),
  ],
]);

const MUTATION_METHODS = new Set(['update', 'updateMany', 'upsert']);

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(absolute));
    } else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(absolute);
    }
  }
  return files;
}

function propertyName(node: ts.ObjectLiteralElementLike): string | null {
  if (!('name' in node) || !node.name) return null;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find(property => propertyName(property) === name);
}

function initializerOf(property: ts.ObjectLiteralElementLike | undefined): ts.Expression | null {
  if (!property) return null;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return null;
}

function resolveObjectLiteral(
  expression: ts.Expression | null,
  source: ts.SourceFile
): ts.ObjectLiteralExpression | null {
  if (!expression) return null;
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isIdentifier(expression)) return null;

  let resolved: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node) => {
    if (
      !resolved &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === expression.text &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      resolved = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return resolved;
}

function incidentMutation(call: ts.CallExpression): { method: string; data: ts.Expression | null } | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  if (!MUTATION_METHODS.has(method)) return null;

  const modelAccess = call.expression.expression;
  if (!ts.isPropertyAccessExpression(modelAccess) || modelAccess.name.text !== 'incident') return null;

  const firstArg = call.arguments[0];
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return { method, data: null };

  const dataProperty = objectProperty(firstArg, method === 'upsert' ? 'update' : 'data');
  return { method, data: initializerOf(dataProperty) };
}

function topLevelFields(object: ts.ObjectLiteralExpression): string[] {
  return object.properties.flatMap(property => {
    const name = propertyName(property);
    return name ? [name] : [];
  });
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function rawSqlViolations(relativePath: string, text: string): string[] {
  // Direct SQL updates are outside Prisma's AST shape, so guard them explicitly.
  // This intentionally ignores SELECT predicates containing lifecycle fields.
  if (!/UPDATE\s+["`]?Incident["`]?/i.test(text)) return [];
  return [...PROTECTED_FIELDS]
    .filter(field => new RegExp(`\\b${field}\\b`).test(text))
    .map(field => `${relativePath}: raw SQL mutates protected field "${field}"`);
}

describe('incident lifecycle mutation architecture', () => {
  it('keeps existing-incident lifecycle writes behind the centralized engine', () => {
    const repositoryRoot = process.cwd();
    const srcRoot = path.join(repositoryRoot, 'src');
    const violations: string[] = [];

    for (const absolutePath of sourceFiles(srcRoot)) {
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
      const text = fs.readFileSync(absolutePath, 'utf8');
      const source = ts.createSourceFile(
        absolutePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        absolutePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const allowed = ALLOWED_FIELDS_BY_FILE.get(relativePath) ?? new Set<string>();

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const mutation = incidentMutation(node);
          if (mutation) {
            const data = resolveObjectLiteral(mutation.data, source);
            // If a production caller hides update data behind a shape this guard
            // cannot inspect, fail closed unless that file is an approved owner.
            if (!data && allowed.size === 0) {
              violations.push(
                `${relativePath}:${lineOf(source, node)} uses opaque incident.${mutation.method} data; lifecycle ownership cannot be verified`
              );
            } else if (data) {
              for (const field of topLevelFields(data)) {
                if (PROTECTED_FIELDS.has(field) && !allowed.has(field)) {
                  violations.push(
                    `${relativePath}:${lineOf(source, node)} directly mutates protected field "${field}" via incident.${mutation.method}`
                  );
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);

      if (!ALLOWED_FIELDS_BY_FILE.has(relativePath)) {
        violations.push(...rawSqlViolations(relativePath, text));
      }
    }

    expect(
      violations,
      `Lifecycle-sensitive incident mutations must go through src/lib/incidents/lifecycle.ts.\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
