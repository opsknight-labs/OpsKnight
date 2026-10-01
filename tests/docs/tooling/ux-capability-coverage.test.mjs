import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const surfaces = [
  {
    name: 'Command Center',
    sources: ['src/app/(app)/page.tsx', 'src/components/dashboard/DashboardCommandCenter.tsx'],
    documentation: 'docs/v2.0.0/guides/dashboard/use-command-center.md',
    required: ['Ops Pulse', 'My Queue', 'Critical Focus', 'Services at Risk', 'SLA Alerts', 'realtime', 'export'],
  },
  {
    name: 'global search and notification inbox',
    sources: ['src/components/SidebarSearch.tsx', 'src/components/TopbarNotifications.tsx'],
    documentation: 'docs/v2.0.0/guides/navigation/search-and-notifications.md',
    required: ['permission-aware', 'All', 'Unread', 'Incidents', 'Shifts', 'Live', 'Polling', 'Delivery History'],
  },
  {
    name: 'keyboard shortcuts',
    sources: ['src/components/GlobalKeyboardHandler.tsx', 'src/components/incident/IncidentsListTable.tsx'],
    documentation: 'docs/v2.0.0/reference/keyboard-shortcuts.md',
    required: ['g`, then `d', 'Create Incident', 'Incident-list triage', 'Known display boundary'],
  },
  {
    name: 'accessibility',
    sources: ['src/components/SkipLink.tsx', 'src/app/globals.css'],
    documentation: 'docs/v2.0.0/reference/accessibility.md',
    required: ['skip link', 'reduced-motion', 'Organization acceptance test', 'Known boundaries'],
  },
  {
    name: 'Settings hub',
    sources: ['src/app/(app)/settings/page.tsx', 'src/components/settings/navConfig.ts'],
    documentation: 'docs/v2.0.0/guides/administration/settings-overview.md',
    required: ['Account and identity', 'Workspace and governance', 'Integrations and ChatOps', 'System and reliability'],
  },
];

test('major cross-cutting UX capabilities have task-oriented documentation', () => {
  for (const surface of surfaces) {
    for (const source of surface.sources) assert.ok(existsSync(source), `${surface.name}: missing source ${source}`);
    assert.ok(existsSync(surface.documentation), `${surface.name}: missing ${surface.documentation}`);
    const content = readFileSync(surface.documentation, 'utf8');
    for (const phrase of surface.required) {
      assert.ok(content.toLowerCase().includes(phrase.toLowerCase()), `${surface.name}: documentation missing ${phrase}`);
    }
  }
});
