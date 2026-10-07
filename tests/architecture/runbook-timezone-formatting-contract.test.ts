import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = {
  libraryPage: readFileSync('src/app/(app)/runbooks/page.tsx', 'utf8'),
  executionsPage: readFileSync('src/app/(app)/runbooks/executions/page.tsx', 'utf8'),
  detailPage: readFileSync('src/app/(app)/runbooks/[id]/page.tsx', 'utf8'),
  agentsPage: readFileSync('src/app/(app)/runbooks/agents/page.tsx', 'utf8'),
  healthPage: readFileSync('src/app/(app)/runbooks/health/page.tsx', 'utf8'),
  incidentRunbooks: readFileSync('src/components/incident/IncidentRunbooks.tsx', 'utf8'),
  libraryClient: readFileSync('src/components/runbooks/RunbookLibrary.tsx', 'utf8'),
  enrollmentClient: readFileSync('src/components/runbooks/AgentEnrollmentForm.tsx', 'utf8'),
};

describe('Runbook timezone formatting contract', () => {
  it('does not render Runbook timestamps with the server or browser default timezone', () => {
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/\.toLocale(?:String|DateString|TimeString)\s*\(/);
    }
  });

  it('formats Runbook timestamps through the saved user timezone', () => {
    for (const source of [
      files.executionsPage,
      files.detailPage,
      files.agentsPage,
      files.healthPage,
      files.incidentRunbooks,
    ]) {
      expect(source).toContain('getUserTimeZone');
      expect(source).toContain('formatDateTime');
    }

    expect(files.libraryPage).toContain('getUserTimeZone');
    expect(files.libraryPage).toContain('userTimeZone={userTimeZone}');
    expect(files.libraryClient).toContain('formatDateTime(item.updatedAt, userTimeZone');

    expect(files.agentsPage).toContain('userTimeZone={userTimeZone}');
    expect(files.enrollmentClient).toContain('formatDateTime(state.expiresAt!, userTimeZone');
  });
});
