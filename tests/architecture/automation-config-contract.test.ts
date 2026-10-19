/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp, security/detect-unsafe-regex -- Static scan of repository files with fixed patterns. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// User-facing Service Automation settings must live in PostgreSQL and be edited in the UI.
// Only test-harness variables (under tests/) may use AUTOMATION_* environment keys.
const ROOT = process.cwd();
const CODE_ROOTS = ['src', 'scripts', 'agent', 'sdk'];
const MANIFEST_ROOTS = ['deploy'];
const MANIFEST_FILES = ['env.example', 'Dockerfile', 'Dockerfile.dev', 'docker-entrypoint.sh'];
const CODE_EXTENSION = /\.(ts|tsx|js|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'generated']);

// Add a key here only for a harness-only variable that ships outside tests/, with a reason.
const ALLOWED_ENV_KEYS = new Set<string>([]);

const CODE_ENV_ACCESS = [
  /process\.env\.([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)/g,
  /process\.env\[\s*['"`]([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)['"`]\s*\]/g,
  /const\s*\{[^}]*?\b([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)\b[^}]*\}\s*=\s*process\.env/g,
];
const MANIFEST_ENV_KEY = [
  /^\s*(?:export\s+)?#?\s*([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)\s*=/gm,
  /^\s*-?\s*name:\s*['"]?([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)['"]?\s*$/gm,
  /^\s*(?:ENV|ARG)\s+([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)\b/gm,
  /^\s+([A-Z0-9_]*AUTOMATION[A-Z0-9_]*)\s*:\s*\S/gm,
];

function collectFiles(root: string, accept: (name: string) => boolean): string[] {
  const absoluteRoot = join(ROOT, root);
  if (!existsSync(absoluteRoot)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(absoluteRoot)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const relativePath = join(root, entry);
    const stat = statSync(join(ROOT, relativePath));
    if (stat.isDirectory()) files.push(...collectFiles(relativePath, accept));
    else if (accept(entry)) files.push(relativePath);
  }
  return files;
}

export function findAutomationEnvKeys(source: string, patterns: RegExp[]): string[] {
  const keys = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(new RegExp(pattern.source, pattern.flags))) {
      keys.add(match[1]);
    }
  }
  return [...keys].filter(key => !ALLOWED_ENV_KEYS.has(key));
}

function violations(files: string[], patterns: RegExp[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const keys = findAutomationEnvKeys(readFileSync(join(ROOT, file), 'utf8'), patterns);
    for (const key of keys) found.push(`${relative(ROOT, join(ROOT, file))}: ${key}`);
  }
  return found;
}

describe('service automation configuration contract', () => {
  it('does not read automation-specific environment variables in production code', () => {
    const files = CODE_ROOTS.flatMap(root =>
      collectFiles(root, name => CODE_EXTENSION.test(name) && !TEST_FILE.test(name))
    );
    expect(violations(files, CODE_ENV_ACCESS)).toEqual([]);
  });

  it('does not ship automation-specific environment variables in deploy manifests or examples', () => {
    const files = [
      ...MANIFEST_ROOTS.flatMap(root => collectFiles(root, () => true)),
      ...MANIFEST_FILES.filter(file => existsSync(join(ROOT, file))),
    ];
    expect(violations(files, MANIFEST_ENV_KEY)).toEqual([]);
  });

  it('detects the access forms it guards against', () => {
    const code = [
      'const a = process.env.AUTOMATION_MAX_RULES;',
      "const b = process.env['SERVICE_AUTOMATION_FLAG'];",
      'const { AUTOMATION_TIMEOUT_MS } = process.env;',
    ].join('\n');
    expect(findAutomationEnvKeys(code, CODE_ENV_ACCESS).sort()).toEqual([
      'AUTOMATION_MAX_RULES',
      'AUTOMATION_TIMEOUT_MS',
      'SERVICE_AUTOMATION_FLAG',
    ]);

    const manifest = ['AUTOMATION_RPS=20', '- name: AUTOMATION_TOPOLOGY', 'ENV AUTOMATION_X 1'].join('\n');
    expect(findAutomationEnvKeys(manifest, MANIFEST_ENV_KEY).sort()).toEqual([
      'AUTOMATION_RPS',
      'AUTOMATION_TOPOLOGY',
      'AUTOMATION_X',
    ]);
  });
});
