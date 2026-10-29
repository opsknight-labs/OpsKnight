import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { acquireRegistrationSlot } from '@/lib/mcp/auth/registration';

describe('registration admission', () => {
  it('lets a few registrations overlap, sheds the rest and frees slots exactly once', () => {
    const held = [acquireRegistrationSlot(), acquireRegistrationSlot(), acquireRegistrationSlot()];
    expect(() => acquireRegistrationSlot()).toThrow('MCP_BUSY');
    held[0]();
    held[0](); // double release must not open a second slot
    const next = acquireRegistrationSlot();
    expect(() => acquireRegistrationSlot()).toThrow('MCP_BUSY');
    for (const release of [...held.slice(1), next]) release();
    expect(() => acquireRegistrationSlot()()).not.toThrow();
  });
});
