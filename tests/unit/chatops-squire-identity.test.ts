// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { investigationQuestion } from '@/lib/chatops/squire/handler';
import {
  slackSquireBlocks,
  slackSquireSender,
  squireIdentityFor,
  teamsSquireHeader,
} from '@/lib/chatops/squire/identity';
import { renderSlackSquireUpdate, renderTeamsSquireUpdate } from '@/lib/chatops/squire/publish';
import { squireAddressedText } from '@/lib/chatops/squire/slack-events';

const BASE = 'https://ops.example.com';

describe('Squire chat identity', () => {
  it('sanitises the configured name and builds an absolute avatar URL', () => {
    const identity = squireIdentityFor('  *Sage*  <@U1> \n', `${BASE}/`);
    expect(identity.name).toBe('Sage @U1');
    expect(identity.avatarUrl).toBe(`${BASE}/squire/squire-avatar.png`);
    expect(identity.avatarReachable).toBe(true);
    expect(squireIdentityFor('', BASE).name).toBe('Squire');
    expect(squireIdentityFor(null, BASE).name).toBe('Squire');
    expect(squireIdentityFor('x'.repeat(100), BASE).name).toHaveLength(40);
  });

  it('leaves the avatar out where chat clients cannot fetch it', () => {
    for (const base of ['http://ops.example.com', 'https://localhost:3000', 'https://127.0.0.1'])
      expect(squireIdentityFor('Squire', base).avatarReachable).toBe(false);
    const local = squireIdentityFor('Squire', 'http://localhost:3000');
    const header = slackSquireBlocks([], local, false)[0] as { elements: Array<{ type: string }> };
    expect(header.elements.map(element => element.type)).toEqual(['mrkdwn']);
    expect(JSON.stringify(teamsSquireHeader(local))).not.toContain('Image');
  });

  it('uses the sender override with the scope, and a header without it', () => {
    const identity = squireIdentityFor('Sage', BASE);
    const body = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }];
    expect(slackSquireSender(identity, true)).toEqual({
      username: 'Sage',
      icon_url: `${BASE}/squire/squire-avatar.png`,
    });
    expect(slackSquireBlocks(body, identity, true)).toEqual(body);
    expect(slackSquireSender(identity, false)).toEqual({});
    const [header, ...rest] = slackSquireBlocks(body, identity, false);
    expect(rest).toEqual(body);
    expect(header).toMatchObject({ type: 'context', block_id: 'squire_identity' });
    expect(JSON.stringify(header)).toContain('*Sage* · OpsKnight assistant');
  });
});

describe('Squire channel update rendering', () => {
  const update = {
    incidentId: 'inc_1',
    kind: 'SUMMARY' as const,
    title: 'Checkout <errors>',
    markdown: 'See [the change](/changes/c1) and [elsewhere](https://evil.example/x).',
  };

  it('links only into OpsKnight, escapes text and bounds the body', () => {
    const identity = squireIdentityFor('Squire', BASE);
    const slack = JSON.stringify(renderSlackSquireUpdate(update, identity, BASE, true));
    expect(slack).toContain(`<${BASE}/changes/c1|the change>`);
    expect(slack).not.toContain('evil.example');
    expect(slack).toContain('Checkout &lt;errors&gt;');
    expect(slack).toContain(`<${BASE}/incidents/inc_1|Open incident>`);
    const long = renderSlackSquireUpdate(
      { ...update, markdown: 'a\n'.repeat(20_000) },
      identity,
      BASE,
      true
    );
    expect(long.blocks.length).toBeLessThanOrEqual(6);

    const teams = renderTeamsSquireUpdate(update, identity, BASE);
    expect(JSON.stringify(teams)).toContain(`[the change](${BASE}/changes/c1)`);
    expect(JSON.stringify(teams)).not.toContain('evil.example');
    expect((teams.body as Array<{ id?: string }>)[0].id).toBe('squire_identity');
  });
});

describe('investigate command', () => {
  it('turns "investigate [focus]" into an investigation of the channel incident', () => {
    expect(investigationQuestion('investigate')).toMatch(/^Investigate this incident\. /);
    expect(investigationQuestion('Investigate: the database')).toContain(
      'focusing on: the database'
    );
    expect(investigationQuestion('what is happening?')).toBeNull();
    expect(investigationQuestion('investigated already?')).toBeNull();
  });

  it('recognises a plain-text "@Squire" (or the configured name) only at the start', () => {
    expect(squireAddressedText('@Squire investigate', 'Squire')).toBe('investigate');
    expect(squireAddressedText('@sage: investigate', 'Sage')).toBe('investigate');
    expect(squireAddressedText('@Sir Squire investigate', 'Sir Squire')).toBe('investigate');
    expect(squireAddressedText('hey @squire investigate', 'Squire')).toBeNull();
    expect(squireAddressedText('@squirely hi', 'Squire')).toBeNull();
    // A message that also mentions the app arrives as app_mention; never answered twice.
    expect(squireAddressedText('@squire <@U0BOT> hi', 'Squire')).toBeNull();
    expect(squireAddressedText('@squire <@U0BOT> hi', 'Squire', 'U0BOT')).toBeNull();
    // Mentioning someone else is part of the question, once the bot's own id is known.
    expect(squireAddressedText('@squire is <@U123> on call?', 'Squire', 'U0BOT')).toBe(
      'is <@U123> on call?'
    );
  });
});
