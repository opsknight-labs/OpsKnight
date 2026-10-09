import { expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { resolveIncidentResponderRouting } from '@/lib/escalation/routing';

it.each([{ snapshotUnavailable: true }, {}])(
  'never reads a mutable policy for a LIVE decision without a snapshot: %j',
  async summary => {
    const lookup = vi.fn();
    const client = {
      incidentAutomationDecision: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            mode: 'LIVE',
            routeType: 'SERVICE_DEFAULT',
            escalationPolicyId: 'legacy',
            summary,
          }),
      },
      escalationPolicy: { findUnique: lookup },
    } as unknown as Prisma.TransactionClient;
    await expect(
      resolveIncidentResponderRouting('incident', 'service', client)
    ).rejects.toMatchObject({ code: 'AUTOMATION_PINNED_POLICY_MISSING' });
    expect(lookup).not.toHaveBeenCalled();
  }
);
