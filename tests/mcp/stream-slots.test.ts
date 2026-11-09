import { describe, expect, it } from 'vitest';
import {
  MAX_STREAMS_PER_GRANT,
  MAX_STREAMS_PER_USER,
  acquireStreamSlot,
  mcpStreamUsage,
} from '@/lib/mcp/protocol/subscriptions';

const code = (action: () => unknown) => {
  try {
    action();
    return 'allowed';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('listen stream capacity', () => {
  it('limits one person across all their connections, not only each connection', () => {
    const held: (() => void)[] = [];
    // Each connection is within its own cap, but together one person may hold only so many.
    for (let grant = 0; held.length < MAX_STREAMS_PER_USER; grant += 1)
      for (
        let stream = 0;
        stream < MAX_STREAMS_PER_GRANT && held.length < MAX_STREAMS_PER_USER;
        stream += 1
      )
        held.push(acquireStreamSlot(`grant-${grant}`, 'person-a'));
    expect(held.length).toBe(MAX_STREAMS_PER_USER);
    expect(code(() => acquireStreamSlot('grant-fresh', 'person-a'))).toBe(
      'MCP_SUBSCRIPTIONS_LIMIT'
    );
    // Someone else is unaffected, and the process count reflects what is open.
    const other = acquireStreamSlot('grant-other', 'person-b');
    expect(mcpStreamUsage().streams).toBe(MAX_STREAMS_PER_USER + 1);
    // Releasing one frees a place for the same person (a second release is a no-op).
    held[0]();
    held[0]();
    const again = acquireStreamSlot('grant-fresh', 'person-a');
    held.slice(1).forEach(release => release());
    again();
    other();
    expect(mcpStreamUsage().streams).toBe(0);
  });
});
