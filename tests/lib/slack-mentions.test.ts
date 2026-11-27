import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/slack/api', () => ({ callSlackApi: h.api }));

import { replaceHandleMentions, resetMentionDirectory } from '@/lib/slack/mentions';

const members = [
  { id: 'U111', name: 'dushyantrahangdale4', profile: { display_name_normalized: 'dushyant' } },
  { id: 'U222', name: 'admin', profile: { real_name_normalized: 'Ops Admin' } },
  { id: 'U333', name: 'gone', deleted: true },
  { id: 'B444', name: 'opsbot', is_bot: true },
];

describe('replaceHandleMentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMentionDirectory();
    h.api.mockResolvedValue({ ok: true, data: { members } });
  });

  it('turns a typed @handle into the mention form the commands parse', async () => {
    expect(await replaceHandleMentions('commander @dushyantrahangdale4', 'xoxb-1')).toBe(
      'commander <@U111>'
    );
    expect(await replaceHandleMentions('@Admin', 'xoxb-1')).toBe('<@U222>');
    expect(await replaceHandleMentions('follow up @dushyant due:2026-12-01', 'xoxb-1')).toBe(
      'follow up <@U111> due:2026-12-01'
    );
  });

  it('leaves unknown handles, bots, deactivated people, emails and real mentions alone', async () => {
    for (const text of [
      '@nobody',
      '@gone',
      '@opsbot',
      'mail a@admin.com',
      '<@U111>',
      'me',
      'no mention here',
    ])
      expect(await replaceHandleMentions(text, 'xoxb-1')).toBe(text);
  });

  it('does not call Slack unless the text has a handle, and caches the directory', async () => {
    await replaceHandleMentions('just words', 'xoxb-1');
    await replaceHandleMentions('already <@U1>', 'xoxb-1');
    expect(h.api).not.toHaveBeenCalled();
    await replaceHandleMentions('@admin', 'xoxb-1');
    await replaceHandleMentions('@admin', 'xoxb-1');
    expect(h.api).toHaveBeenCalledTimes(1);
  });

  it('fails soft when Slack cannot list people', async () => {
    h.api.mockResolvedValue({ ok: false, error: 'ratelimited' });
    expect(await replaceHandleMentions('@admin', 'xoxb-1')).toBe('@admin');
    h.api.mockRejectedValue(new Error('network'));
    resetMentionDirectory();
    expect(await replaceHandleMentions('@admin', 'xoxb-1')).toBe('@admin');
  });
});
