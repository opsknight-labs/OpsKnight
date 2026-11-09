import { describe, expect, it } from 'vitest';
import { projectMcpData, summarizeRedactions } from '@/lib/mcp/core/projection';

describe('email addresses inside free text', () => {
  it('are redacted and counted, wherever they sit in a value', () => {
    const redacted: string[] = [];
    const out = projectMcpData(
      {
        timeline: [
          { message: 'War-room: Could not invite user (sarah.chen@acmecorp.io): not in Slack' },
          { message: 'Notified bob+oncall@sub.example.co.uk and carol@example.org.' },
        ],
      },
      redacted
    ) as { timeline: { message: string }[] };
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/sarah|chen|acmecorp|bob\+|example\.co\.uk|carol@/);
    expect(out.timeline[0].message).toBe(
      'War-room: Could not invite user ([REDACTED_EMAIL]): not in Slack'
    );
    // The sentence's final full stop is not swallowed by the address.
    expect(out.timeline[1].message).toBe('Notified [REDACTED_EMAIL] and [REDACTED_EMAIL].');
    expect(summarizeRedactions(redacted).redactedFields).toEqual(['/timeline/*/message']);
    expect(summarizeRedactions(redacted).redactedCount).toBe(2);
  });

  it('catches an address cut off by a stored title, and leaves non-addresses alone', () => {
    const out = projectMcpData({
      cut: 'Could not invite user (sarah.chen@acmeco...',
      plain: 'deploy v2@1.4 on host a @ b, see #ops and @oncall; mail root@localhost',
    }) as { cut: string; plain: string };
    expect(out.cut).toBe('Could not invite user ([REDACTED_EMAIL]...');
    expect(out.plain).toBe(
      'deploy v2@1.4 on host a @ b, see #ops and @oncall; mail root@localhost'
    );
  });
});
