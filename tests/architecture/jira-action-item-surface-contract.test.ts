import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const canonicalSurface = 'src/components/action-items/ActionItemJiraContext.tsx';
const parentSurfaces = [
  'src/components/postmortem/PostmortemActionItems.tsx',
  'src/components/postmortem/PostmortemDetailView.tsx',
  'src/components/incident/detail/IncidentPostmortemTabContent.tsx',
  'src/components/action-items/ActionItemsBoard.tsx',
] as const;

describe('action-item Jira UX surface contract', () => {
  it('centralizes the Action Item Jira label and capability-aware visibility', () => {
    const canonical = readFileSync(canonicalSurface, 'utf8');

    expect(canonical).toContain('Action Item Jira');
    expect(canonical).toContain('jiraCapability.canCreate || jiraCapability.canLink');
    expect(canonical).toContain('if (!hasHistoricalLink && !canStartJiraTracking) return null');
  });

  it('does not duplicate raw Jira labels or badge visibility logic in parent surfaces', () => {
    for (const path of parentSurfaces) {
      const source = readFileSync(path, 'utf8');

      expect(source, path).toContain('ActionItemJiraContext');
      expect(source, path).not.toContain('ActionItemJiraBadge');
      expect(source, path).not.toContain('Action Item Jira');
    }
  });
});
