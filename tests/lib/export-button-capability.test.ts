import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { resolveUserActor } from '@/lib/authorization-actors';
import { CAPABILITIES, capabilitiesOf, hasCapability } from '@/lib/authorization';
import { actorHasCapability } from '@/lib/authorization-policy';

vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn() } },
}));

/** A USER (no export in its built-in role) whose custom role grants report.export. */
function customRoleUser(capabilities: string[]) {
  return {
    id: 'user-1',
    role: 'USER',
    status: 'ACTIVE',
    teamMemberships: [],
    customRole: { id: 'cr-1', name: 'Analyst', capabilities, archivedAt: null },
    accessGrants: [],
  };
}

describe('export button visibility follows the capabilities the export route checks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the export button to a custom role that grants report.export', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      customRoleUser(['report.read', 'report.export']) as never
    );
    const actor = (await resolveUserActor('user-1'))!;

    // The export route asserts capabilitiesOf(<effective user>), which includes the custom role.
    expect(capabilitiesOf({ role: actor.role, capabilities: [...actor.capabilities!] })).toContain(
      CAPABILITIES.REPORT_EXPORT
    );
    // The old page check only looked at the built-in role and hid the button from this person.
    expect(hasCapability(actor.role, CAPABILITIES.REPORT_EXPORT)).toBe(false);
    expect(actorHasCapability(actor, CAPABILITIES.REPORT_EXPORT)).toBe(true);
  });

  it('keeps the button hidden when neither the role nor a custom role grants export', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(customRoleUser(['report.read']) as never);
    const actor = (await resolveUserActor('user-1'))!;

    expect(actorHasCapability(actor, CAPABILITIES.REPORT_EXPORT)).toBe(false);
  });

  it.each([
    'src/app/(app)/page.tsx',
    'src/app/(app)/insights/page.tsx',
    'src/app/(app)/insights/business-impact/page.tsx',
  ])('%s decides canExport from the effective capabilities', path => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed page paths above
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('actorHasCapability(actor, CAPABILITIES.REPORT_EXPORT)');
    expect(source).not.toMatch(/hasCapability\(\s*actor\.role,\s*CAPABILITIES\.REPORT_EXPORT/);
  });
});
