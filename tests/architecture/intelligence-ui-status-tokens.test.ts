import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Intelligence UI uses the status-* tokens (src/lib/design/status-palette.ts) for status colour, never
 * raw red/green/amber Tailwind palettes, so light and dark mode stay consistent and contrast is owned
 * in one place. Snapshot-free: it reads the source of every surface the consistency pass touched.
 */
const FILES = [
  'src/components/incident/IncidentAiSummary.tsx',
  'src/components/incident/IncidentImpactCard.tsx',
  'src/components/incident/TriageChips.tsx',
  'src/components/incident/intelligence/AskSquireAbout.tsx',
  'src/components/incident/intelligence/FreshnessDot.tsx',
  'src/components/incident/intelligence/IncidentGroupView.tsx',
  'src/components/incident/intelligence/IncidentInsights.tsx',
  'src/components/incident/intelligence/IncidentInsightsInspector.tsx',
  'src/components/incident/intelligence/InsightsInspectorHost.tsx',
  'src/components/incident/intelligence/InsightsSections.tsx',
  'src/components/incident/intelligence/IntelligenceStrip.tsx',
  'src/components/incident/intelligence/ProactiveNotes.tsx',
  'src/components/settings/NoiseControlsForms.tsx',
  'src/components/settings/IntelligenceSettingsForms.tsx',
  'src/components/settings/noise-controls/HeartbeatPanel.tsx',
  'src/components/settings/noise-controls/MaintenanceWindowsPanel.tsx',
  'src/components/settings/noise-controls/MatcherRows.tsx',
  'src/components/settings/noise-controls/OrchestrationRulesBuilder.tsx',
  'src/components/settings/noise-controls/SuppressionRuleBuilder.tsx',
  'src/components/settings/noise-controls/shared.tsx',
  'src/app/(app)/settings/intelligence/page.tsx',
  'src/app/(app)/settings/intelligence/noise-controls/page.tsx',
  'src/app/(app)/settings/intelligence/services/page.tsx',
  'src/app/(app)/settings/intelligence/ai/page.tsx',
  'src/app/(app)/settings/intelligence/evaluation/page.tsx',
  'src/app/(app)/settings/intelligence/_sections/DependenciesChangesSections.tsx',
  'src/app/(app)/settings/intelligence/_sections/InsightsSections.tsx',
  'src/app/(app)/settings/intelligence/_sections/GroupingQualitySection.tsx',
  'src/app/(app)/settings/intelligence/_sections/AiUsageSpendSections.tsx',
  'src/app/(app)/settings/intelligence/_sections/ConnectionsSection.tsx',
  'src/app/(app)/settings/intelligence/_sections/KnowledgeMemorySection.tsx',
  'src/components/settings/layout/IntelligenceGroupHeader.tsx',
  'src/components/settings/layout/IntelligenceSubNav.tsx',
];

const RAW_STATUS_COLOUR =
  /\b(?:text|bg|border|ring|from|to|via|fill|stroke|outline|divide|decoration)-(?:red|green|emerald|amber|yellow|rose|orange|lime)-\d{2,3}\b/g;

describe('intelligence UI status colours and markup', () => {
  it.each(FILES)('%s uses status-* tokens, not raw red/green/amber classes', file => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed list of repository files above
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source.match(RAW_STATUS_COLOUR) ?? []).toEqual([]);
  });

  // Badge renders a <div>. Inside a <p>, the browser's HTML parser splits the paragraph, so the
  // server HTML no longer matches the React tree and hydration fails.
  const BLOCK_IN_PARAGRAPH = /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<(?:Badge|div|ul|ol)\b/g;

  it.each(FILES)('%s keeps badges and blocks out of <p>', file => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed list of repository files above
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    expect(source.match(BLOCK_IN_PARAGRAPH) ?? []).toEqual([]);
  });

  it('detects a badge in a paragraph, so the nesting check cannot pass vacuously', () => {
    expect(
      '<p className="x">name <Badge>Repeats</Badge></p>'.match(BLOCK_IN_PARAGRAPH)
    ).toHaveLength(1);
    expect('<p>a</p><div><Badge>b</Badge></div>'.match(BLOCK_IN_PARAGRAPH)).toBeNull();
  });

  it('detects a raw class, so the check cannot pass vacuously', () => {
    expect('className="text-emerald-600 bg-red-500/5"'.match(RAW_STATUS_COLOUR)).toEqual([
      'text-emerald-600',
      'bg-red-500',
    ]);
  });
});
