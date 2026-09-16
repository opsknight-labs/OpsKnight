import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function getAllFiles(dir: string): string[] {
  let results: string[] = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      results.push(filePath);
    }
  }
  return results;
}

describe('Incident Collaboration Architectural Boundaries', () => {
  it('ensures UI components under src/components/incident do NOT import provider-specific libraries directly', () => {
    const incidentComponentFiles = getAllFiles('src/components/incident');

    // UI components must never import Slack or Microsoft Teams provider internals directly.
    // All collaboration state, capabilities, badges, and actions must come via @/lib/incident-collaboration
    const forbiddenPatterns = [
      /@\/lib\/slack(?!\/constants)/,
      /@\/lib\/microsoft-teams/,
      /@\/lib\/chatops\/war-room/,
    ];

    const violations: Array<{ file: string; match: string }> = [];

    for (const file of incidentComponentFiles) {
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
