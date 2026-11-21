// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findingAnchor,
  findingHref,
  insightsSectionFor,
  openSquire,
  parseSquireOpenDetail,
  subscribeSquireOpen,
  SQUIRE_EVIDENCE_KINDS,
  INSIGHTS_SECTIONS,
} from '@/components/squire/squire-bus';
import {
  readSquireDeepLink,
  squireDeepLink,
  withoutSquireDeepLink,
} from '@/components/squire/deep-link';
import {
  queryAddressesAssistant,
  questionFromPaletteQuery,
} from '@/components/squire/palette-question';
import { describeSquireContext } from '@/components/squire/page-context';
import { findingHrefForCitation, parsePinnedBriefing } from '@/components/squire/briefing-store';
import { KEYBOARD_SHORTCUTS } from '@/lib/keyboard-shortcuts';

describe('squire-bus open request', () => {
  it('keeps well-formed fields and drops everything else', () => {
    expect(
      parseSquireOpenDetail({
        question: '  Why is this the cause?  ',
        evidence: { kind: 'change', id: 'f_1', label: ' Deploy api v9 ', extra: true },
        incidentId: 'inc_1',
        unknown: 'x',
      })
    ).toEqual({
      question: 'Why is this the cause?',
      evidence: { kind: 'change', id: 'f_1', label: 'Deploy api v9' },
      incidentId: 'inc_1',
    });
    expect(parseSquireOpenDetail(undefined)).toEqual({});
    expect(parseSquireOpenDetail('text')).toEqual({});
    expect(parseSquireOpenDetail({ message: { evil: true }, question: 42 })).toEqual({});
    expect(parseSquireOpenDetail({ message: '   ' })).toEqual({});
  });

  it('prefers a message to send over a question to pre-fill, and bounds text', () => {
    expect(parseSquireOpenDetail({ message: 'send me', question: 'prefill me' })).toEqual({
      message: 'send me',
    });
    expect(parseSquireOpenDetail({ question: 'q'.repeat(5000) }).question).toHaveLength(2000);
    expect(
      parseSquireOpenDetail({ evidence: { kind: 'change', id: 'f', label: 'l'.repeat(500) } })
        .evidence?.label
    ).toHaveLength(120);
  });

  it.each([
    { kind: 'nonsense', id: 'f_1' },
    { kind: 'change', id: '../x' },
    { kind: 'change', id: '' },
    { kind: 'change', id: 'a'.repeat(65) },
    { kind: 'change' },
    'change:f_1',
    null,
  ])('rejects malformed evidence %j', evidence => {
    expect(parseSquireOpenDetail({ evidence })).toEqual({});
  });

  it('rejects an incident id that is not a plain identifier', () => {
    expect(parseSquireOpenDetail({ incidentId: 'inc/1' })).toEqual({});
    expect(parseSquireOpenDetail({ incidentId: 7 })).toEqual({});
  });

  it('dispatches a string as a message and an object as a validated request', () => {
    const seen: unknown[] = [];
    const stop = subscribeSquireOpen(event => seen.push((event as CustomEvent).detail));
    openSquire('Summarise this incident');
    openSquire({ question: 'Why?', evidence: { kind: 'similar', id: 'f_2' } });
    openSquire();
    openSquire('');
    stop();
    expect(seen).toEqual([
      { message: 'Summarise this incident' },
      { question: 'Why?', evidence: { kind: 'similar', id: 'f_2' } },
      {},
      {},
    ]);
  });

  describe('before the launcher has mounted', () => {
    afterEach(() => vi.useRealTimers());
    it('replays a queued object request once a listener subscribes', () => {
      vi.useFakeTimers();
      openSquire({ question: 'Queued?', incidentId: 'inc_9' });
      const seen: unknown[] = [];
      const stop = subscribeSquireOpen(event => seen.push((event as CustomEvent).detail));
      vi.runAllTimers();
      stop();
      expect(seen).toEqual([{ question: 'Queued?', incidentId: 'inc_9' }]);
    });
  });
});

describe('finding anchors', () => {
  it('anchors a finding as #finding-<id> under its inspector section', () => {
    expect(findingAnchor('f_1')).toBe('finding-f_1');
    expect(findingHref('inc_1', { kind: 'change', id: 'f_1' })).toBe(
      '/incidents/inc_1?insights=why#finding-f_1'
    );
    expect(findingHref('inc_1', { kind: 'similar', id: 'f_2' })).toBe(
      '/incidents/inc_1?insights=similar#finding-f_2'
    );
    expect(findingHref('inc_1', { kind: 'runbook', id: 'f_3' }, { mobile: true })).toBe(
      '/m/incidents/inc_1?insights=runbooks#finding-f_3'
    );
    // Kinds without an inspector section still get the anchor.
    expect(findingHref('inc_1', { kind: 'timeline', id: 'f_4' })).toBe(
      '/incidents/inc_1#finding-f_4'
    );
  });

  it('builds no link from ids that are not plain identifiers', () => {
    expect(findingHref('inc 1', { kind: 'change', id: 'f_1' })).toBeUndefined();
    expect(findingHref('inc_1', { kind: 'change', id: 'f/1' })).toBeUndefined();
  });

  it('maps every finding kind to a known section or to none', () => {
    for (const kind of SQUIRE_EVIDENCE_KINDS) {
      const section = insightsSectionFor(kind);
      if (section) expect(INSIGHTS_SECTIONS).toContain(section);
    }
    expect(insightsSectionFor('group')).toBe('related');
    expect(insightsSectionFor('service')).toBeUndefined();
  });

  it('links a cited source to its finding only when the briefing holds it', () => {
    const briefing = parsePinnedBriefing({
      incidentId: 'inc_1',
      similar: [{ findingId: 'f_s', incidentId: 'inc_old', title: 'Old', matchPercent: 80 }],
      changes: [{ findingId: 'f_c', changeId: 'chg_1', summary: 'Deploy' }],
      runbooks: [{ findingId: 'f_r', runbookId: 'rb_1', name: 'Restart' }],
    });
    expect(findingHrefForCitation(briefing, { kind: 'incident', id: 'inc_old' })).toBe(
      '/incidents/inc_1?insights=similar#finding-f_s'
    );
    expect(findingHrefForCitation(briefing, { kind: 'change', id: 'chg_1' })).toBe(
      '/incidents/inc_1?insights=why#finding-f_c'
    );
    expect(
      findingHrefForCitation(briefing, { kind: 'runbook', id: 'rb_1' }, { mobile: true })
    ).toBe('/m/incidents/inc_1?insights=runbooks#finding-f_r');
    expect(findingHrefForCitation(briefing, { kind: 'change', id: 'chg_2' })).toBeUndefined();
    expect(findingHrefForCitation(briefing, { kind: 'service', id: 'chg_1' })).toBeUndefined();
    expect(findingHrefForCitation(null, { kind: 'change', id: 'chg_1' })).toBeUndefined();
  });

  it('pins the shared incident summary, even with no finding rows', () => {
    const briefing = parsePinnedBriefing({
      incidentId: 'inc_1',
      similar: [],
      changes: [],
      runbooks: [],
      summary: { headline: 'Checkout is failing', currentState: 'Errors since the 10:02 deploy.' },
    });
    expect(briefing?.summary).toEqual({
      headline: 'Checkout is failing',
      currentState: 'Errors since the 10:02 deploy.',
    });
    expect(
      parsePinnedBriefing({
        incidentId: 'inc_1',
        similar: [],
        changes: [],
        runbooks: [],
        summary: { headline: '' },
      })
    ).toBeNull();
  });

  it('treats a malformed or empty briefing as nothing to pin', () => {
    expect(parsePinnedBriefing(null)).toBeNull();
    expect(parsePinnedBriefing({ similar: [] })).toBeNull();
    expect(
      parsePinnedBriefing({ incidentId: 'inc_1', similar: [], changes: [], runbooks: [] })
    ).toBeNull();
    expect(
      parsePinnedBriefing({ incidentId: 'inc_1', similar: [{ title: 'no ids' }, 'x', null] })
    ).toBeNull();
  });
});

describe('?squire=open deep link', () => {
  it('reads the question only when squire=open', () => {
    expect(readSquireDeepLink('?squire=open&q=What%20is%20on%20fire%3F')).toEqual({
      question: 'What is on fire?',
    });
    expect(readSquireDeepLink('?squire=open')).toEqual({});
    expect(readSquireDeepLink('?squire=open&q=%20%20')).toEqual({});
    expect(readSquireDeepLink('?q=hello')).toBeNull();
    expect(readSquireDeepLink('?squire=closed&q=hello')).toBeNull();
    expect(readSquireDeepLink('')).toBeNull();
    expect(readSquireDeepLink(`?squire=open&q=${'x'.repeat(3000)}`)?.question).toHaveLength(2000);
  });

  it('round-trips through the link builder and strips only its own parameters', () => {
    const link = squireDeepLink('/incidents/inc_1?tab=timeline#finding-f_1', 'Why did this page?');
    expect(link).toBe(
      '/incidents/inc_1?tab=timeline&squire=open&q=Why+did+this+page%3F#finding-f_1'
    );
    expect(readSquireDeepLink(link.slice(link.indexOf('?'), link.indexOf('#')))).toEqual({
      question: 'Why did this page?',
    });
    expect(withoutSquireDeepLink(link)).toBe('/incidents/inc_1?tab=timeline#finding-f_1');
    expect(withoutSquireDeepLink('https://app.example/services?squire=open')).toBe('/services');
    expect(squireDeepLink('/incidents')).toBe('/incidents?squire=open');
  });
});

describe('command palette question', () => {
  it('offers the assistant for its name, a keyword or a question', () => {
    expect(queryAddressesAssistant('pip', 'Pip')).toBe(true);
    expect(queryAddressesAssistant('ask about checkout', 'Pip')).toBe(true);
    expect(queryAddressesAssistant('is checkout down?', 'Pip')).toBe(true);
    expect(queryAddressesAssistant('why is checkout failing', 'Pip')).toBe(true);
    expect(queryAddressesAssistant('checkout', 'Pip')).toBe(false);
    expect(queryAddressesAssistant('list services', 'Pip')).toBe(false);
    expect(queryAddressesAssistant('a', 'Pip')).toBe(false);
  });

  it('hands over the question without the words that only address the assistant', () => {
    expect(questionFromPaletteQuery('ask pip, why is checkout failing?', 'Pip')).toBe(
      'why is checkout failing?'
    );
    expect(questionFromPaletteQuery('Sir Pip who is on call', 'Sir Pip')).toBe('who is on call');
    expect(questionFromPaletteQuery('is checkout down?', 'Pip')).toBe('is checkout down?');
    expect(questionFromPaletteQuery('help', 'Pip')).toBe('help');
    expect(questionFromPaletteQuery('pip', 'Pip')).toBeUndefined();
    expect(questionFromPaletteQuery('ask ai', 'Pip')).toBeUndefined();
    expect(questionFromPaletteQuery('ask ?', 'Pip')).toBeUndefined();
  });
});

describe('context chip wording', () => {
  it.each([
    ['/incidents/inc_1', 'incident', 'Discussing this incident'],
    ['/m/incidents/inc_1', 'incident', 'Discussing this incident'],
    ['/services/svc_1', 'service', 'Discussing this service'],
    ['/teams/t_1', 'team', 'Discussing this team'],
    ['/runbooks/rb_1', 'runbook', 'Discussing this runbook'],
    ['/schedules/s_1', 'schedule', 'Discussing this schedule'],
    ['/alerts/a_1', 'alert', 'Discussing this alert'],
    ['/changes/c_1', 'change', 'Discussing this change'],
    ['/incidents', 'general', 'General conversation'],
    ['/incidents/new', 'general', 'General conversation'],
    ['/runbooks/health', 'general', 'General conversation'],
    [null, 'general', 'General conversation'],
  ])('%s', (path, subject, label) => {
    expect(describeSquireContext(path)).toEqual({ subject, label });
  });
});

describe('keyboard shortcut', () => {
  it('still lists ⌘J for the assistant on the shortcuts page', () => {
    const shortcut = KEYBOARD_SHORTCUTS.find(entry => entry.id === 'squire-toggle');
    expect(shortcut).toMatchObject({ keys: ['⌘/Ctrl', 'J'], runtimeOwner: 'SquireLauncher' });
  });
});
