import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = {
  libraryPage: readFileSync('src/app/(app)/runbooks/page.tsx', 'utf8'),
  executionsPage: readFileSync('src/app/(app)/runbooks/executions/page.tsx', 'utf8'),
  executionDetailPage: readFileSync('src/app/(app)/runbooks/executions/[id]/page.tsx', 'utf8'),
  detailPage: readFileSync('src/app/(app)/runbooks/[id]/page.tsx', 'utf8'),
  agentsPage: readFileSync('src/app/(app)/runbooks/agents/page.tsx', 'utf8'),
  agentsSecurityPage: readFileSync('src/app/(app)/runbooks/agents/security/page.tsx', 'utf8'),
  agentSetupPage: readFileSync('src/app/(app)/runbooks/agents/[id]/setup/page.tsx', 'utf8'),
  healthPage: readFileSync('src/app/(app)/runbooks/health/page.tsx', 'utf8'),
  incidentRunbooks: readFileSync('src/components/incident/IncidentRunbooks.tsx', 'utf8'),
  libraryClient: readFileSync('src/components/runbooks/RunbookLibrary.tsx', 'utf8'),
  enrollmentClient: readFileSync('src/components/runbooks/AgentEnrollmentForm.tsx', 'utf8'),
  ruleConfigurationCheck: readFileSync(
    'src/components/runbooks/RuleConfigurationCheck.tsx',
    'utf8'
  ),
  serviceRuleCard: readFileSync('src/components/service/runbooks/RuleCard.tsx', 'utf8'),
  automationRulePresentation: readFileSync(
    'src/components/service/automation-rule/rule-presentation.ts',
    'utf8'
  ),
  serviceAutomationRulePage: readFileSync(
    'src/app/(app)/services/[id]/automations/[ruleId]/page.tsx',
    'utf8'
  ),
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
      files.executionDetailPage,
      files.detailPage,
      files.agentsPage,
      files.agentsSecurityPage,
      files.agentSetupPage,
      files.healthPage,
      files.incidentRunbooks,
    ]) {
      expect(source).toContain('getUserTimeZone');
      expect(source).toContain('formatDateTime');
    }

    expect(files.serviceAutomationRulePage).toContain('getUserTimeZone');
    expect(files.automationRulePresentation).toContain('formatDateTime');

    expect(files.libraryPage).toContain('getUserTimeZone');
    expect(files.libraryPage).toContain('userTimeZone={userTimeZone}');
    expect(files.libraryClient).toContain('formatDateTime(item.updatedAt, userTimeZone');

    expect(files.agentsPage).toContain('userTimeZone={userTimeZone}');
    expect(files.enrollmentClient).toContain('formatDateTime(state.expiresAt!, userTimeZone');

    expect(files.serviceRuleCard).toContain('formatDateTime');
    expect(files.ruleConfigurationCheck).toContain('formatDateTime');
  });
});
