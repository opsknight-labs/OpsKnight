import { describe, expect, it } from 'vitest';
import {
  aiRoutingInputSchema,
  applyCapabilityRoute,
  readCapabilityRouting,
  routingFromForm,
} from '@/lib/intelligence/ai/routing';

const chain = [
  { id: 'a', model: 'small' },
  { id: 'b', model: 'medium' },
  { id: 'c', model: 'large' },
];

describe('per-capability model routing', () => {
  it('leaves the priority chain unchanged when no route is set', () => {
    expect(applyCapabilityRoute(chain, undefined, 'DIAGNOSE')).toEqual(chain);
    expect(applyCapabilityRoute(chain, {}, 'DIAGNOSE')).toEqual(chain);
    expect(applyCapabilityRoute(chain, { CLASSIFY: { providerId: 'c' } }, 'DIAGNOSE')).toEqual(
      chain
    );
  });

  it('moves the routed provider first with its model override and keeps the rest as fallback', () => {
    const routed = applyCapabilityRoute(
      chain,
      { DIAGNOSE: { providerId: 'c', model: 'reasoning-xl' } },
      'DIAGNOSE'
    );
    expect(routed.map(provider => provider.id)).toEqual(['c', 'a', 'b']);
    expect(routed[0].model).toBe('reasoning-xl');
    // The stored provider object is never mutated.
    expect(chain[2].model).toBe('large');
  });

  it('never widens the chain: a provider the data policy excluded stays excluded', () => {
    const eligible = chain.filter(provider => provider.id !== 'c');
    expect(
      applyCapabilityRoute(eligible, { DIAGNOSE: { providerId: 'c' } }, 'DIAGNOSE').map(
        provider => provider.id
      )
    ).toEqual(['a', 'b']);
  });

  it('does not route embeddings', () => {
    expect(
      applyCapabilityRoute(chain, readCapabilityRouting({ EMBED: { providerId: 'c' } }), 'EMBED')
    ).toEqual(chain);
  });

  it('re-validates stored routing and drops malformed entries', () => {
    expect(
      readCapabilityRouting({
        DIAGNOSE: { providerId: 'p1', model: 'gpt-4.1' },
        CLASSIFY: { providerId: '' },
        SUMMARIZE: { providerId: 'p2', model: 'bad model with spaces' },
        EMBED: { providerId: 'p3' },
        UNKNOWN: { providerId: 'p4' },
      })
    ).toEqual({ DIAGNOSE: { providerId: 'p1', model: 'gpt-4.1' } });
    expect(readCapabilityRouting(null)).toEqual({});
    expect(readCapabilityRouting(['x'])).toEqual({});
  });

  it('validates the settings input strictly', () => {
    expect(
      aiRoutingInputSchema.safeParse({
        squireInvestigationEnabled: true,
        capabilityRouting: { CLASSIFY: { providerId: 'p1', model: 'claude-haiku-4-5' } },
        expectedRevision: 3,
      }).success
    ).toBe(true);
    for (const capabilityRouting of [
      { EMBED: { providerId: 'p1' } },
      { CLASSIFY: { providerId: 'p1', extra: true } },
      { CLASSIFY: { model: 'x' } },
      { CLASSIFY: { providerId: 'p1', model: '../../etc' } },
    ])
      expect(
        aiRoutingInputSchema.safeParse({
          squireInvestigationEnabled: false,
          capabilityRouting,
          expectedRevision: 0,
        }).success
      ).toBe(false);
  });

  it('reads provider and model fields from the form, skipping capabilities left on the default', () => {
    const form = new FormData();
    form.set('route.DIAGNOSE.provider', 'p1');
    form.set('route.DIAGNOSE.model', ' strong ');
    form.set('route.CLASSIFY.provider', '');
    form.set('route.CLASSIFY.model', 'ignored');
    form.set('route.SUMMARIZE.provider', 'p2');
    expect(routingFromForm(form)).toEqual({
      DIAGNOSE: { providerId: 'p1', model: 'strong' },
      SUMMARIZE: { providerId: 'p2' },
    });
  });
});
