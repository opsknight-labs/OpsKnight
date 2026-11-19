import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// These server pages pass Prisma relations straight into client components, so a
// full User include would serialize passwordHash and phone numbers into the RSC payload.
const PAGES = [
  'src/components/incident/IncidentDetailScreen.tsx',
  'src/app/(app)/policies/[id]/page.tsx',
];

describe('client-bound user relations', () => {
  it.each(PAGES)('%s never includes full user rows', file => {
    const source = readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/\b(user|assignee|targetUser|teamLead)\s*:\s*true\b/);
    expect(source).not.toMatch(/include:\s*\{\s*(user|teamLead)\s*:\s*true/);
  });
});
