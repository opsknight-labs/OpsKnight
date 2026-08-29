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
const INCIDENT_UPDATE_SQL = /UPDATE\s+["`]?Incident["`]?\s+SET\s+/i;
const SQL_CLAUSE_END = /\s+(?:WHERE|RETURNING)\b/i;

function sourceFiles(root: string): string[] {
  return ts.sys
    .readDirectory(root, ['.ts', '.tsx'], undefined, undefined)
    .filter(file => !file.endsWith('.d.ts'));
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

function staticStringText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;

  return [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ');
}

function rawSqlViolations(relativePath: string, node: ts.Node): string[] {
  const sql = staticStringText(node);
  if (!sql) return [];

  const updateMatch = INCIDENT_UPDATE_SQL.exec(sql);
  if (!updateMatch) return [];

  const setStart = updateMatch.index + updateMatch[0].length;
  const tail = sql.slice(setStart);
  const clauseEnd = SQL_CLAUSE_END.exec(tail);
  const setClause = (clauseEnd ? tail.slice(0, clauseEnd.index) : tail).toLowerCase();

  return [...PROTECTED_FIELDS]
    .filter(field => setClause.includes(field.toLowerCase()))
    .map(field => `${relativePath}: raw SQL mutates protected field "${field}"`);
}

describe('incident lifecycle mutation architecture', () => {
  it('keeps existing-incident lifecycle writes behind the centralized engine', () => {
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

        if (!ALLOWED_FIELDS_BY_FILE.has(relativePath)) {
          violations.push(...rawSqlViolations(relativePath, node));
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(
      violations,
      `Lifecycle-sensitive incident mutations must go through src/lib/incidents/lifecycle.ts.\n${violations.join('\n')}`
    ).toEqual([]);
  });
});
