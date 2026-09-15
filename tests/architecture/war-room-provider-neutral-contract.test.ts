import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('provider-neutral war-room architecture', () => {
  it('routes durable workers only through the neutral engine', () => {
    const queue = readFileSync('src/lib/jobs/queue.ts', 'utf8');
    const eventSideEffects = readFileSync('src/lib/event-side-effects.ts', 'utf8');

    expect(queue).toContain("import('../war-room/engine')");
    expect(queue).not.toContain("import('../war-room/microsoft-teams')");
    expect(queue).not.toContain("import('../war-room/participants')");
    expect(queue).not.toContain("import('../war-room/projection')");
    expect(queue).not.toContain('chatops/war-room');
    expect(eventSideEffects).toContain("import('./war-room/engine')");
    expect(eventSideEffects).not.toContain('chatops/war-room');
    expect(eventSideEffects).not.toContain('war-room/microsoft-teams');
    expect(eventSideEffects).not.toContain('war-room/projection');
    expect(eventSideEffects).not.toContain('war-room/participants');
  });

  it('keeps provider implementations out of the central engine', () => {
    const engine = readFileSync('src/lib/war-room/engine.ts', 'utf8');

    expect(engine).toContain("from './registry'");
    expect(engine).not.toMatch(/providers\/(slack|microsoft-teams)/);
    expect(engine).not.toContain('microsoft-teams');
    expect(engine).not.toContain('chatops/war-room');
  });

  it('registers Slack and Teams behind one capability contract', () => {
    const provider = readFileSync('src/lib/war-room/provider.ts', 'utf8');
    const registry = readFileSync('src/lib/war-room/registry.ts', 'utf8');

    expect(provider).toContain('interface WarRoomProviderAdapter');
    expect(provider).toContain('type WarRoomProviderCapabilities');
    expect(provider).toContain('type ProviderOperationResult');
    expect(provider).toContain('AMBIGUOUS_SIDE_EFFECT');
    expect(registry).toContain('microsoftTeamsWarRoomAdapter');
    expect(registry).toContain('slackWarRoomAdapter');
  });
});
