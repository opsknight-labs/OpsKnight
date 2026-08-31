import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const DIRECT_PROVIDER_MODULES = new Set(['email', 'sms', 'push', 'whatsapp', 'slack', 'webhooks']);
const ALLOWED_PROVIDER_SENDERS = new Set([
  'src/lib/notification-control-plane.ts',
  'src/lib/notification-delivery.ts',
  'src/lib/incident-push-delivery.ts',
]);

function providerModule(specifier: string): string | null {
  const match = specifier.match(/(?:^@\/lib\/|^\.\/)(email|sms|push|whatsapp|slack|webhooks)$/);
  return match?.[1] || null;
}

describe('notification control-plane architecture', () => {
  it('prevents new production senders from importing provider adapters directly', () => {
    const root = process.cwd();
    const violations: string[] = [];
    for (const absolute of ts.sys.readDirectory(path.join(root, 'src'), ['.ts', '.tsx'])) {
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const sourceText = ts.sys.readFile(absolute);
      if (!sourceText) continue;
      if (ALLOWED_PROVIDER_SENDERS.has(relative)) continue;
      const source = ts.createSourceFile(absolute, sourceText, ts.ScriptTarget.Latest, true);
      source.forEachChild(node => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
        const provider = providerModule(node.moduleSpecifier.text);
        if (!provider || !DIRECT_PROVIDER_MODULES.has(provider)) return;
        const importedNames =
          node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
            ? node.importClause.namedBindings.elements.map(element => element.name.text)
            : [];
        if (importedNames.some(name => /^(?:send|notify)/.test(name))) {
          violations.push(`${relative}: ${provider}`);
        }
      });
      if (
        /\{\s*(?:send|notify)[A-Za-z0-9_]*\s*\}\s*=\s*await\s+import\(['"](?:@\/lib\/|\.\/)(?:email|sms|push|whatsapp|slack|webhooks)['"]\)/.test(
          sourceText
        )
      )
        violations.push(`${relative}: dynamic provider sender`);
    }
    expect(
      violations,
      `Outbound producers must create durable notification intents.\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('keeps the personal history endpoint separate from the workspace operations endpoint', () => {
    const personal = ts.sys.readFile(
      path.join(process.cwd(), 'src/app/api/notifications/history/route.ts')
    );
    const operations = ts.sys.readFile(
      path.join(process.cwd(), 'src/app/api/admin/notifications/operations/route.ts')
    );
    expect(personal).toMatch(/userId\s*:\s*user\.id/);
    expect(operations).toContain("user.role !== 'ADMIN' && user.role !== 'AUDITOR'");
  });
});
