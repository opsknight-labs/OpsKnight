/**
 * Compact renderings of one Squire answer for Slack (Block Kit) and Microsoft Teams (Adaptive Cards).
 *
 * Pure functions: no I/O, so the exact payloads are unit tested. The answer text is model or template
 * output that may quote third-party text (alert payloads, notes), so it is always escaped for the target
 * format and only links into OpsKnight itself become clickable. Proposal buttons carry the sealed proposal
 * token and the id of the person it was made for; neither authorizes anything by itself, because the
 * executor re-opens the token for the clicking person and refuses anyone else.
 */

/** Block Kit and Teams invoke action identifiers. */
export const SQUIRE_SLACK_CONFIRM_ACTION = 'squire_confirm';
export const SQUIRE_SLACK_DISMISS_ACTION = 'squire_dismiss';
export const SQUIRE_TEAMS_CONFIRM_VERB = 'squire.confirm';

/** Slack rejects a button whose value is longer than this. */
export const SLACK_BUTTON_VALUE_MAX = 2_000;
const SLACK_SECTION_MAX = 2_900;
const MAX_SECTIONS = 3;
const MAX_CITATIONS = 6;
const MAX_PROPOSALS = 2;

export interface ChatSquireCitation {
  kind: string;
  label: string;
  href: string;
}

export interface ChatSquireProposal {
  token: string;
  kind: 'WRITE' | 'NAVIGATE';
  title: string;
  detail: string;
  incidentId: string;
  expiresAt: string;
  href?: string;
  untrustedContext?: boolean;
  /**
   * False when the action has no chat confirmation path (extended and knowledge actions): the card then
   * opens OpsKnight instead of offering a Confirm button that could only fail.
   */
  chatConfirmable?: boolean;
}

/** A WRITE proposal that chat can actually confirm. */
const confirmableInChat = (proposal: ChatSquireProposal) =>
  proposal.kind === 'WRITE' && proposal.chatConfirmable !== false;

/** One answered turn, already collected from the stream. */
export interface ChatSquireAnswer {
  name: string;
  mode: 'ai' | 'basic';
  text: string;
  notices: string[];
  citations: ChatSquireCitation[];
  proposals: ChatSquireProposal[];
  /** Set when the turn failed; `text` is then empty. */
  error?: string;
}

export interface RenderOptions {
  /** Absolute application origin, for links. */
  baseUrl: string;
  /** The OpsKnight user the answer was made for; only they may confirm its proposals. */
  ownerUserId: string;
}

const trimSlash = (value: string) => value.replace(/\/+$/, '');

/** An in-app link made absolute; anything that does not point into OpsKnight returns null. */
export function appLink(href: string, baseUrl: string): string | null {
  const base = trimSlash(baseUrl);
  if (/^\/(?!\/)[^\s]*$/.test(href)) return `${base}${href}`;
  try {
    const url = new URL(href);
    const origin = new URL(base).origin;
    return url.origin === origin ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Slack control characters; everything else in mrkdwn is harmless once these are escaped. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g;

/** Markdown answer text to Slack mrkdwn: escaped, with only OpsKnight links clickable. */
export function markdownToSlack(markdown: string, baseUrl: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  return lines
    .map(line => {
      let out = '';
      let last = 0;
      for (const match of line.matchAll(LINK)) {
        out += inlineSlack(line.slice(last, match.index), last === 0);
        const url = appLink(match[2], baseUrl);
        const label = escapeSlack(match[1]).replace(/\|/g, '/');
        out += url ? `<${url}|${label}>` : label;
        last = match.index! + match[0].length;
      }
      out += inlineSlack(line.slice(last), last === 0);
      return out;
    })
    .join('\n');
}

function inlineSlack(text: string, lineStart: boolean): string {
  const escaped = escapeSlack(text);
  const structured = lineStart
    ? escaped.replace(/^#{1,6}\s+(.+)$/, '*$1*').replace(/^(\s*)[-*]\s+/, '$1• ')
    : escaped;
  return structured.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/__([^_\n]+)__/g, '_$1_');
}

/** Teams markdown: links outside OpsKnight lose their target, and raw HTML is neutralised. */
export function markdownToTeams(markdown: string, baseUrl: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(LINK, (_whole, label: string, href: string) => {
      const url = appLink(href, baseUrl);
      return url ? `[${label}](${url})` : label;
    });
}

function chunks(text: string, size: number, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0 && out.length < max) {
    if (rest.length <= size) {
      out.push(rest);
      break;
    }
    const cut = rest.lastIndexOf('\n', size);
    const at = cut > size / 2 ? cut : size;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).replace(/^\n/, '');
    if (out.length === max && rest) out[max - 1] = `${out[max - 1].slice(0, size - 1)}…`;
  }
  return out;
}

/** The button value Slack sends back on click: the sealed token and the person it was made for. */
export function squireButtonValue(token: string, ownerUserId: string): string {
  return JSON.stringify({ v: 1, t: token, o: ownerUserId });
}

export function parseSquireButtonValue(value: unknown): { token: string; owner: string } | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 9_000) return null;
  try {
    const parsed = JSON.parse(value) as { v?: unknown; t?: unknown; o?: unknown };
    if (parsed.v !== 1 || typeof parsed.t !== 'string' || typeof parsed.o !== 'string') return null;
    if (!parsed.t || parsed.t.length > 8_192 || !parsed.o || parsed.o.length > 64) return null;
    return { token: parsed.t, owner: parsed.o };
  } catch {
    return null;
  }
}

const UNTRUSTED_WARNING = 'Based on alert or note content. Check that content before confirming.';

/** Block Kit for one answer, replied in a thread or as the slash-command response. */
export function renderSlackAnswer(
  answer: ChatSquireAnswer,
  options: RenderOptions
): { text: string; blocks: Record<string, unknown>[] } {
  const blocks: Record<string, unknown>[] = [];
  if (answer.error) {
    const text = `:warning: ${escapeSlack(answer.error)}`;
    return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] };
  }
  const body = markdownToSlack(
    answer.text.trim() || 'I could not find an answer.',
    options.baseUrl
  );
  for (const part of chunks(body, SLACK_SECTION_MAX, MAX_SECTIONS))
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: part } });
  for (const notice of answer.notices.slice(0, 2))
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `:information_source: ${escapeSlack(notice)}` }],
    });
  const sources = answer.citations
    .slice(0, MAX_CITATIONS)
    .map(citation => {
      const url = appLink(citation.href, options.baseUrl);
      const label = escapeSlack(citation.label).replace(/\|/g, '/');
      return url ? `<${url}|${label}>` : label;
    })
    .filter(Boolean);
  if (sources.length)
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Sources: ${sources.join(' · ')}` }],
    });
  for (const proposal of answer.proposals.slice(0, MAX_PROPOSALS)) {
    const detail = `*${escapeSlack(proposal.title)}*\n${escapeSlack(proposal.detail)}${
      proposal.untrustedContext ? `\n:warning: ${UNTRUSTED_WARNING}` : ''
    }`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: detail } });
    const link = appLink(
      proposal.href ?? `/incidents/${encodeURIComponent(proposal.incidentId)}`,
      options.baseUrl
    );
    const value = squireButtonValue(proposal.token, options.ownerUserId);
    if (confirmableInChat(proposal) && value.length <= SLACK_BUTTON_VALUE_MAX) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: SQUIRE_SLACK_CONFIRM_ACTION,
            text: { type: 'plain_text', text: 'Confirm', emoji: false },
            style: 'primary',
            value,
          },
          {
            type: 'button',
            action_id: SQUIRE_SLACK_DISMISS_ACTION,
            text: { type: 'plain_text', text: 'Dismiss', emoji: false },
            value: squireButtonValue('-', options.ownerUserId),
          },
        ],
      });
    } else if (link) {
      // Navigation, an action only the application can confirm, or a proposal too large for a Slack
      // button: open it in OpsKnight instead.
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: 'squire_open',
            text: { type: 'plain_text', text: 'Open in OpsKnight', emoji: false },
            url: link,
          },
        ],
      });
    }
  }
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${escapeSlack(answer.name)} · ${answer.mode === 'ai' ? 'AI' : 'Basic mode'} · answered with the asker's permissions${
          answer.proposals.some(confirmableInChat) ? ' · only the asker can confirm' : ''
        }`,
      },
    ],
  });
  const fallback = answer.text.trim().slice(0, 300) || 'Squire answered.';
  return { text: escapeSlack(fallback), blocks };
}

/** Adaptive Card (1.5) for one answer, replied in a Teams war-room thread. */
export function renderTeamsAnswer(
  answer: ChatSquireAnswer,
  options: RenderOptions
): Record<string, unknown> {
  const body: Record<string, unknown>[] = [];
  const actions: Record<string, unknown>[] = [];
  if (answer.error) {
    body.push({
      type: 'TextBlock',
      wrap: true,
      text: markdownToTeams(answer.error, options.baseUrl),
    });
  } else {
    body.push({
      type: 'TextBlock',
      wrap: true,
      text: markdownToTeams(
        (answer.text.trim() || 'I could not find an answer.').slice(0, 8_000),
        options.baseUrl
      ),
    });
    for (const notice of answer.notices.slice(0, 2))
      body.push({ type: 'TextBlock', wrap: true, isSubtle: true, size: 'Small', text: notice });
    const sources = answer.citations
      .slice(0, MAX_CITATIONS)
      .map(citation => {
        const url = appLink(citation.href, options.baseUrl);
        const label = citation.label.replace(/[[\]]/g, '');
        return url ? `[${label}](${url})` : label;
      })
      .filter(Boolean);
    if (sources.length)
      body.push({
        type: 'TextBlock',
        wrap: true,
        size: 'Small',
        text: `Sources: ${sources.join(' · ')}`,
      });
    for (const proposal of answer.proposals.slice(0, MAX_PROPOSALS)) {
      body.push({
        type: 'Container',
        style: 'emphasis',
        items: [
          { type: 'TextBlock', wrap: true, weight: 'Bolder', text: proposal.title },
          { type: 'TextBlock', wrap: true, text: proposal.detail },
          ...(proposal.untrustedContext
            ? [{ type: 'TextBlock', wrap: true, color: 'Warning', text: UNTRUSTED_WARNING }]
            : []),
        ],
      });
      const link = appLink(
        proposal.href ?? `/incidents/${encodeURIComponent(proposal.incidentId)}`,
        options.baseUrl
      );
      if (confirmableInChat(proposal))
        actions.push({
          type: 'Action.Execute',
          title: `Confirm: ${proposal.title}`.slice(0, 80),
          verb: SQUIRE_TEAMS_CONFIRM_VERB,
          data: { squire: { v: 1, t: proposal.token, o: options.ownerUserId } },
        });
      else if (link)
        actions.push({
          type: 'Action.OpenUrl',
          title: (proposal.kind === 'WRITE'
            ? `Open in OpsKnight: ${proposal.title}`
            : proposal.title
          ).slice(0, 80),
          url: link,
        });
    }
  }
  body.push({
    type: 'TextBlock',
    wrap: true,
    isSubtle: true,
    size: 'Small',
    text: `${answer.name} · ${answer.mode === 'ai' ? 'AI' : 'Basic mode'} · answered with the asker's permissions`,
  });
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body,
    ...(actions.length ? { actions } : {}),
  };
}

/** The Teams invoke payload of a Squire confirm button, or null for any other action. */
export function parseTeamsSquireAction(value: unknown): { token: string; owner: string } | null {
  if (!value || typeof value !== 'object') return null;
  const action = (value as { action?: { verb?: unknown; data?: unknown } }).action;
  if (!action || action.verb !== SQUIRE_TEAMS_CONFIRM_VERB) return null;
  const squire = (action.data as { squire?: unknown } | undefined)?.squire;
  if (!squire || typeof squire !== 'object') return null;
  return parseSquireButtonValue(JSON.stringify(squire));
}

/** Whether a Teams invoke is a Squire button (so the incident-card handler never sees it). */
export function isTeamsSquireInvoke(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { action?: { verb?: unknown } }).action?.verb === SQUIRE_TEAMS_CONFIRM_VERB
  );
}

/** The question in a mention: bot mentions and Teams `<at>` tags removed, whitespace collapsed. */
export function questionFromMention(text: string): string {
  return text
    .replace(/<at>[^<]{0,200}<\/at>/gi, ' ')
    .replace(/<@[A-Z0-9]{2,32}[^>]{0,81}>/g, ' ')
    .replace(/^\s*@?squire\b[:,]?/i, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000);
}
