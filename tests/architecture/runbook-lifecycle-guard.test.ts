import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = {
  libraryPage: readFileSync('src/app/(app)/runbooks/page.tsx', 'utf8'),
  actions: readFileSync('src/app/(app)/runbooks/actions.ts', 'utf8'),
  lifecycle: readFileSync('src/lib/runbooks/lifecycle.ts', 'utf8'),
  schemas: readFileSync('src/lib/runbooks/schemas.ts', 'utf8'),
  schemaPrisma: readFileSync('prisma/schema.prisma', 'utf8'),
};

describe('Runbook Lifecycle Architecture Guard', () => {
  it('ensures archived runbooks remain discoverable and not permanently hidden', () => {
    // 1. Library page must not have an unconditional hardcoded "archivedAt: null" where clause
    expect(files.libraryPage).not.toMatch(/where:\s*\{[^}]*archivedAt:\s*null[^}]*total\s*=/);
    expect(files.libraryPage).toContain('buildRunbookLibraryWhere');

    // 2. Library page must calculate archived runbooks count
    expect(files.libraryPage).toContain('archivedCount');
    expect(files.libraryPage).toMatch(/archivedAt:\s*\{\s*not:\s*null\s*\}/);

    // 3. Lifecycle query builder must allow querying archived items
    expect(files.lifecycle).toContain("filter.tab === 'archived'");
    expect(files.lifecycle).toContain("filter.status === 'archived'");
    expect(files.lifecycle).toMatch(/archivedAt:\s*isArchivedView\s*\?\s*\{\s*not:\s*null\s*\}\s*:\s*null/);
  });

  it('enforces safe delete rules preventing destruction of execution history', () => {
    // 1. Deletion action must route through lifecycle deleteRunbook
    expect(files.actions).toContain('deleteRunbookAction');
    expect(files.actions).toContain('deleteRunbook(');

    // 2. Lifecycle delete must enforce execution check
    expect(files.lifecycle).toContain('hasExecutions');
    expect(files.lifecycle).toContain('execution history');

    // 3. Lifecycle delete must enforce binding check
    expect(files.lifecycle).toContain('hasBindings');
    expect(files.lifecycle).toContain('service bindings');

    // 4. Schema relation foreign key safety: RunbookExecution must restrict runbook deletion
    expect(files.schemaPrisma).toMatch(/model\s+RunbookExecution\s+\{[\s\S]*?runbook\s+Runbook\s+@relation\([\s\S]*?onDelete:\s*Restrict/);
  });

  it('guarantees restore does not silently re-enable dangerous automatic bindings', () => {
    // 1. restoreRunbook must explicitly keep AUTOMATIC bindings disabled
    expect(files.lifecycle).toMatch(/mode:\s*['"]AUTOMATIC['"]/);
    expect(files.lifecycle).toMatch(/enabled:\s*false/);

    // 2. restoreRunbookAction must exist in actions.ts
    expect(files.actions).toContain('restoreRunbookAction');
    expect(files.actions).toContain('restoreRunbook(');
  });

  it('enforces bounded server pagination and schema limits', () => {
    // 1. Page query must use RUNBOOK_PAGE_SIZE and bounded take
    expect(files.libraryPage).toContain('RUNBOOK_PAGE_SIZE');
    expect(files.libraryPage).toContain('take: RUNBOOK_PAGE_SIZE');

    // 2. Schemas must bound pageSize to maximum 100
    expect(files.schemas).toMatch(/pageSize:\s*z\.coerce\.number\(\)[^;]*?\.max\(100\)/);
  });
});
