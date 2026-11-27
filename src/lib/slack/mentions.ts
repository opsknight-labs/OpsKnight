import { callSlackApi } from '@/lib/slack/api';

/**
 * Slack sends a person in slash-command text as `<@U123>` only when the command's "Escape channels,
 * users, and links" option is on. OpsKnight's manifest leaves it off, so that notes, summaries and
 * titles reach us as typed. A typed mention then arrives as a plain `@handle`. This turns such a handle
 * into the `<@U123>` form the commands already parse, by looking the person up in the workspace.
 */
type SlackMember = {
  id?: string;
  name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name_normalized?: string; real_name_normalized?: string };
};

const DIRECTORY_TTL_MS = 5 * 60_000;
const MAX_PAGES = 5;
const directories = new Map<string, { at: number; byName: Map<string, string> }>();

/** Matches `@handle` only as a whole word, so an email address is never touched. */
const HANDLE = /(^|\s)@([A-Za-z0-9][A-Za-z0-9._-]{0,79})(?=\s|$)/g;

async function loadDirectory(token: string): Promise<Map<string, string>> {
  const cached = directories.get(token);
  if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.byName;
  const byName = new Map<string, string>();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await callSlackApi<{
      members?: SlackMember[];
      response_metadata?: { next_cursor?: string };
    }>(
      'users.list',
      token,
      { limit: 200, ...(cursor ? { cursor } : {}) },
      { form: true, timeoutMs: 3_000 }
    );
    if (!result.ok) break;
    for (const member of result.data.members ?? []) {
      if (!member.id || member.deleted || member.is_bot) continue;
      // First entry wins, so a handle is never reassigned to a different person with the same display name.
      for (const key of [
        member.name,
        member.profile?.display_name_normalized,
        member.profile?.real_name_normalized,
      ]) {
        const normalized = key?.trim().toLowerCase();
        if (normalized && !byName.has(normalized)) byName.set(normalized, member.id);
      }
    }
    cursor = result.data.response_metadata?.next_cursor ?? '';
    if (!cursor) break;
  }
  if (byName.size > 0) directories.set(token, { at: Date.now(), byName });
  return byName;
}

/** Replaces each `@handle` that names a workspace member with `<@U123>`; anything else is left as typed. */
export async function replaceHandleMentions(text: string, token: string): Promise<string> {
  if (!text.includes('@')) return text;
  HANDLE.lastIndex = 0;
  if (!HANDLE.test(text)) return text;
  HANDLE.lastIndex = 0;
  let directory: Map<string, string>;
  try {
    directory = await loadDirectory(token);
  } catch {
    return text;
  }
  return text.replace(HANDLE, (whole, lead: string, handle: string) => {
    const id = directory.get(handle.toLowerCase());
    return id ? `${lead}<@${id}>` : whole;
  });
}

/** Test seam. */
export function resetMentionDirectory(): void {
  directories.clear();
}
