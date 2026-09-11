import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function expectCentralizedParent(source: string, name: string) {
  expect(source, name).toContain('ActionItemJiraContext');
  expect(source, name).not.toContain('ActionItemJiraBadge');
  expect(source, name).not.toContain('Action Item Jira');
}

describe('action-item Jira UX surface contract', () => {
  it('centralizes the Action Item Jira label and capability-aware visibility', () => {
    const canonical = readFileSync(
      'src/components/action-items/ActionItemJiraContext.tsx',
      'utf8'
    );

    expect(canonical).toContain('Action Item Jira');
    expect(canonical).toContain('jiraCapability.canCreate || jiraCapability.canLink');
    expect(canonical).toContain('if (!hasHistoricalLink && !canStartJiraTracking) return null');
  });

  it('does not duplicate raw Jira labels or badge visibility logic in parent surfaces', () => {
    const postmortemEditor = readFileSync(
      'src/components/postmortem/PostmortemActionItems.tsx',
      'utf8'
    );
    const postmortemDetail = readFileSync(
      'src/components/postmortem/PostmortemDetailView.tsx',
      'utf8'
    );
    const incidentPostmortemTab = readFileSync(
      'src/components/incident/detail/IncidentPostmortemTabContent.tsx',
      'utf8'
    );
    const actionItemsBoard = readFileSync(
      'src/components/action-items/ActionItemsBoard.tsx',
      'utf8'
    );

    expectCentralizedParent(postmortemEditor, 'PostmortemActionItems');
    expectCentralizedParent(postmortemDetail, 'PostmortemDetailView');
    expectCentralizedParent(incidentPostmortemTab, 'IncidentPostmortemTabContent');
    expectCentralizedParent(actionItemsBoard, 'ActionItemsBoard');
  });
});
