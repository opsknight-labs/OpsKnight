import { describe, expect, it } from 'vitest';
import {
  aiRoutingInputSchema,
  applyCapabilityRoute,
  applyDefaultTiers,
  defaultModelFor,
  PROVIDER_MODEL_TIERS,
  readCapabilityRouting,
  routingFromForm,
} from '@/lib/intelligence/ai/routing';
import { resolveModelPrice } from '@/lib/intelligence/ai/pricing';

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

describe('default model tiers', () => {
  const providers = [
    { id: 'a', kind: 'ANTHROPIC' as const, model: 'claude-sonnet-5-5' },
    { id: 'z', kind: 'AZURE_OPENAI' as const, model: 'my-deployment' },
  ];

  it('sends cheap, frequent work to the small model and conclusions to the strong one', () => {
    expect(applyDefaultTiers(providers, 'CLASSIFY').map(p => p.model)).toEqual([
      'claude-haiku-5-5',
      'my-deployment',
    ]);
    expect(applyDefaultTiers(providers, 'SUMMARIZE')[0].model).toBe('claude-haiku-5-5');
    for (const capability of ['DIAGNOSE', 'POSTMORTEM', 'SQUIRE_CHAT'] as const)
      expect(applyDefaultTiers(providers, capability)[0].model).toBe('claude-opus-5-5');
  });

  it('forces the small tier for degradation and keeps embeddings and unknown hosts untouched', () => {
    expect(applyDefaultTiers(providers, 'DIAGNOSE', 'small')[0].model).toBe('claude-haiku-5-5');
    expect(applyDefaultTiers(providers, 'EMBED')).toEqual(providers);
    expect(defaultModelFor('OPENAI_COMPATIBLE', 'CLASSIFY')).toBeUndefined();
  });

  it('lets an explicit route win over the default tier', () => {
    const tiered = applyDefaultTiers(providers, 'DIAGNOSE');
    const routed = applyCapabilityRoute(
      tiered,
      { DIAGNOSE: { providerId: 'a', model: 'claude-sonnet-5-5' } },
      'DIAGNOSE'
    );
    expect(routed[0].model).toBe('claude-sonnet-5-5');
  });

  it('only names models the built-in price table knows', () => {
    for (const [kind, tiers] of Object.entries(PROVIDER_MODEL_TIERS))
      for (const model of Object.values(tiers ?? {}))
        expect(
          resolveModelPrice(kind as keyof typeof PROVIDER_MODEL_TIERS, model),
          `${kind} ${model}`
        ).not.toBeNull();
  });
});
