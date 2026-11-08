import { describe, expect, it } from 'vitest';
import {
  appLink,
  isTeamsSquireInvoke,
  markdownToSlack,
  markdownToTeams,
  parseSquireButtonValue,
  parseTeamsSquireAction,
  questionFromMention,
  renderSlackAnswer,
  renderTeamsAnswer,
  SLACK_BUTTON_VALUE_MAX,
  squireButtonValue,
  SQUIRE_SLACK_CONFIRM_ACTION,
  SQUIRE_SLACK_DISMISS_ACTION,
  SQUIRE_TEAMS_CONFIRM_VERB,
  type ChatSquireAnswer,
} from '@/lib/chatops/squire/render';
import { encryptWithKey } from '@/lib/encryption';

const BASE = 'https://ops.example.com';
const answer = (overrides: Partial<ChatSquireAnswer> = {}): ChatSquireAnswer => ({
  name: 'Squire',
  mode: 'basic',
  text: 'The **payments** service has 2 open incidents. See [the incident](/incidents/inc_1).',
  notices: [],
  citations: [{ kind: 'incident', label: 'Checkout errors', href: '/incidents/inc_1' }],
  proposals: [],
  ...overrides,
});
const writeProposal = {
  token: 'sealed-token',
  kind: 'WRITE' as const,
  title: 'Acknowledge the incident',
  detail: 'Marks Checkout errors as acknowledged.',
  incidentId: 'inc_1',
  expiresAt: '2026-11-08T10:00:00.000Z',
};

describe('Squire chat rendering: links', () => {
  it('makes in-app links absolute and refuses everything else', () => {
    expect(appLink('/incidents/x', `${BASE}/`)).toBe(`${BASE}/incidents/x`);
    expect(appLink(`${BASE}/services/s`, BASE)).toBe(`${BASE}/services/s`);
    expect(appLink('https://evil.example/incidents/x', BASE)).toBeNull();
    expect(appLink('//evil.example/x', BASE)).toBeNull();
    expect(appLink('javascript:alert(1)', BASE)).toBeNull();
  });

  it('converts markdown to Slack mrkdwn, escaping control characters and foreign links', () => {
    const text = markdownToSlack(
      '# Summary\n- **bold** <@U123> & <!channel>\n[ok](/incidents/a) [bad](https://evil.example/x)',
      BASE
    );
    expect(text).toContain('*Summary*');
    expect(text).toContain('• *bold* &lt;@U123&gt; &amp; &lt;!channel&gt;');
    expect(text).toContain(`<${BASE}/incidents/a|ok>`);
    expect(text).toContain('bad');
    expect(text).not.toContain('evil.example');
  });

  it('keeps a dash after a link as text, not a bullet', () => {
    expect(markdownToSlack('[a](/incidents/a) - next', BASE)).toBe(
      `<${BASE}/incidents/a|a> - next`
    );
  });

  it('neutralises HTML and foreign links for Teams', () => {
    const text = markdownToTeams('<img src=x> [ok](/runbooks/r) [bad](https://evil.example)', BASE);
    expect(text).toContain('&lt;img src=x&gt;');
    expect(text).toContain(`[ok](${BASE}/runbooks/r)`);
    expect(text).not.toContain('evil.example');
  });
});

describe('Squire chat rendering: Slack', () => {
  it('renders the answer, sources as links, and who it answered for', () => {
    const { text, blocks } = renderSlackAnswer(answer(), { baseUrl: BASE, ownerUserId: 'u1' });
    expect(text).toContain('payments');
    const json = JSON.stringify(blocks);
    expect(json).toContain(`<${BASE}/incidents/inc_1|Checkout errors>`);
    expect(json).toContain("answered with the asker's permissions");
    expect(json).not.toContain(SQUIRE_SLACK_CONFIRM_ACTION);
  });

  it('offers Confirm and Dismiss carrying the sealed token and the owner', () => {
    const { blocks } = renderSlackAnswer(
      answer({ proposals: [{ ...writeProposal, untrustedContext: true }] }),
      { baseUrl: BASE, ownerUserId: 'u1' }
    );
    const actions = blocks.find(block => block.type === 'actions') as {
      elements: { action_id: string; value?: string }[];
    };
    expect(actions.elements.map(element => element.action_id)).toEqual([
      SQUIRE_SLACK_CONFIRM_ACTION,
      SQUIRE_SLACK_DISMISS_ACTION,
    ]);
    expect(parseSquireButtonValue(actions.elements[0].value)).toEqual({
      token: 'sealed-token',
      owner: 'u1',
    });
    expect(JSON.stringify(blocks)).toContain('Check that content before confirming');
    expect(JSON.stringify(blocks)).toContain('only the asker can confirm');
  });

  it('falls back to an OpsKnight link when a sealed token is too large for a Slack button', () => {
    const { blocks } = renderSlackAnswer(
      answer({ proposals: [{ ...writeProposal, token: 'x'.repeat(SLACK_BUTTON_VALUE_MAX) }] }),
      { baseUrl: BASE, ownerUserId: 'u1' }
    );
    const json = JSON.stringify(blocks);
    expect(json).not.toContain(SQUIRE_SLACK_CONFIRM_ACTION);
    expect(json).toContain(`${BASE}/incidents/inc_1`);
  });

  it('renders navigation proposals as links, never as confirm buttons', () => {
    const { blocks } = renderSlackAnswer(
      answer({
        proposals: [
          { ...writeProposal, kind: 'NAVIGATE', title: 'Open the runbook', href: '/runbooks/r1' },
        ],
      }),
      { baseUrl: BASE, ownerUserId: 'u1' }
    );
    const json = JSON.stringify(blocks);
    expect(json).not.toContain(SQUIRE_SLACK_CONFIRM_ACTION);
    expect(json).toContain(`${BASE}/runbooks/r1`);
  });

  it('shows an error alone, escaped', () => {
    const { text, blocks } = renderSlackAnswer(answer({ error: 'Nope <@here>', text: '' }), {
      baseUrl: BASE,
      ownerUserId: '',
    });
    expect(text).toContain('Nope &lt;@here&gt;');
    expect(blocks).toHaveLength(1);
  });

  it('splits a long answer into at most three sections within Slack limits', () => {
    const { blocks } = renderSlackAnswer(answer({ text: 'line\n'.repeat(5_000), citations: [] }), {
      baseUrl: BASE,
      ownerUserId: 'u1',
    });
    const sections = blocks.filter(block => block.type === 'section') as {
      text: { text: string };
    }[];
    expect(sections.length).toBeLessThanOrEqual(3);
    for (const section of sections) expect(section.text.text.length).toBeLessThanOrEqual(3_000);
  });

  it('fits a sealed acknowledge or short-resolution proposal in a Slack button value', async () => {
    // A maximum-length resolution or note does not fit; it is offered as an OpsKnight link instead
    // (covered above), never truncated.
    const sealed = await encryptWithKey(
      JSON.stringify({
        v: 1,
        id: '6f1c2a8e-3b44-4c0e-9a51-2f0d7e9b1c3a',
        action: 'resolve_incident',
        input: { incidentId: 'cmh1x2y3z0000abcd1234efgh', resolution: 'r'.repeat(400) },
        actorId: 'cmh1x2y3z0000abcd1234user',
        exp: Date.now() + 600_000,
        preconditions: {
          incident: {
            status: 'ACKNOWLEDGED',
            escalationGeneration: 3,
            assigneeId: 'cmh1x2y3z0000abcd1234user',
            teamId: 'cmh1x2y3z0000abcd1234team',
            updatedAt: new Date().toISOString(),
          },
        },
      }),
      '68112f544b2c8b0f84436ea34293f733c33e49b41e657b9db0275f5edf09c7ba'
    );
    expect(squireButtonValue(sealed, 'cmh1x2y3z0000abcd1234user').length).toBeLessThanOrEqual(
      SLACK_BUTTON_VALUE_MAX
    );
  });
});

describe('Squire chat rendering: Teams', () => {
  it('renders an Adaptive Card with Action.Execute confirm carrying token and owner', () => {
    const card = renderTeamsAnswer(answer({ proposals: [writeProposal] }), {
      baseUrl: BASE,
      ownerUserId: 'u1',
    }) as { actions: { type: string; verb?: string; data?: unknown }[] };
    expect(card.actions[0]).toMatchObject({
      type: 'Action.Execute',
      verb: SQUIRE_TEAMS_CONFIRM_VERB,
    });
    const value = {
      action: {
        type: 'Action.Execute',
        verb: SQUIRE_TEAMS_CONFIRM_VERB,
        data: card.actions[0].data,
      },
    };
    expect(isTeamsSquireInvoke(value)).toBe(true);
    expect(parseTeamsSquireAction(value)).toEqual({ token: 'sealed-token', owner: 'u1' });
    expect(JSON.stringify(card)).toContain(`[Checkout errors](${BASE}/incidents/inc_1)`);
  });

  it('never treats an incident-card action as a Squire action', () => {
    const value = { action: { verb: 'incident.acknowledge', data: { incidentId: 'x' } } };
    expect(isTeamsSquireInvoke(value)).toBe(false);
    expect(parseTeamsSquireAction(value)).toBeNull();
  });
});

describe('Squire chat rendering: inputs', () => {
  it('extracts the question from Slack and Teams mentions', () => {
    expect(questionFromMention('<@U0SQUIRE> what changed?')).toBe('what changed?');
    expect(questionFromMention('<at>Squire</at> who is on call')).toBe('who is on call');
    expect(questionFromMention('@squire: is this related?')).toBe('is this related?');
    expect(questionFromMention('<@U0SQUIRE>')).toBe('');
  });

  it('rejects malformed button values', () => {
    expect(parseSquireButtonValue('not json')).toBeNull();
    expect(parseSquireButtonValue(JSON.stringify({ v: 2, t: 'x', o: 'u' }))).toBeNull();
    expect(parseSquireButtonValue(JSON.stringify({ v: 1, t: '', o: 'u' }))).toBeNull();
    expect(parseSquireButtonValue(undefined)).toBeNull();
  });
});
