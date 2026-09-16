import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const WAR_ROOM_UI_FILES = [
  'src/components/incident/war-room/IncidentMeetingCard.tsx',
  'src/components/incident/war-room/IncidentWarRoomManager.tsx',
  'src/components/incident/war-room/WarRoomActionsMenu.tsx',
  'src/components/incident/war-room/WarRoomCreateDialog.tsx',
  'src/components/incident/war-room/WarRoomDiagnostics.tsx',
  'src/components/incident/war-room/WarRoomHealthBadge.tsx',
  'src/components/incident/war-room/WarRoomHistory.tsx',
  'src/components/incident/war-room/WarRoomLauncher.tsx',
  'src/components/incident/war-room/WarRoomLifecycleBadge.tsx',
  'src/components/incident/war-room/WarRoomParticipantSummary.tsx',
  'src/components/incident/war-room/WarRoomProviderCard.tsx',
  'src/components/incident/war-room/WarRoomProviderHeader.tsx',
];

describe('Incident Collaboration Architectural Boundaries', () => {
  it('ensures UI components under src/components/incident/war-room do NOT import provider-specific libraries directly', () => {
    // UI components must never import Slack or Microsoft Teams provider internals directly.
    // All collaboration state, capabilities, badges, and actions must come via @/lib/incident-collaboration
    const forbiddenPatterns = [
      /@\/lib\/slack(?!\/constants)/,
      /@\/lib\/microsoft-teams/,
      /@\/lib\/chatops\/war-room/,
    ];

    const violations: Array<{ file: string; match: string }> = [];

    for (const file of WAR_ROOM_UI_FILES) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern);
        if (match) {
          violations.push({ file, match: match[0] });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('ensures getIncidentCollaborationView performs NO network/external provider calls', () => {
    const fileContent = readFileSync(
      'src/lib/incident-collaboration/get-incident-collaboration.ts',
      'utf8'
    );

    // Must NOT call fetch, axios, GraphClient, WebClient
    expect(fileContent).not.toMatch(/\bfetch\(/);
    expect(fileContent).not.toMatch(/\baxios\b/);
    expect(fileContent).not.toMatch(/@microsoft\/microsoft-graph-client/);
    expect(fileContent).not.toMatch(/@slack\/web-api/);
  });
});
