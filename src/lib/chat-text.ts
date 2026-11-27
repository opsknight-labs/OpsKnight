/**
 * Plain chat messages (title, text, optional link) rendered for Slack and Microsoft Teams. Used by
 * the bot path (business-service status, error budgets) and by incoming-webhook subscribers.
 */

export type ChatLink = { label: string; url: string };

/** Slack mrkdwn treats &, < and > as control characters. */
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeLinks(links: readonly ChatLink[]): ChatLink[] {
  return links.filter(link => /^https?:\/\//i.test(link.url));
}

/** chat.postMessage / incoming-webhook body. */
export function slackTextBody(title: string, text: string, links: readonly ChatLink[] = []) {
  const linkLine = safeLinks(links)
    .map(link => `<${link.url.replace(/[<>|]/g, '')}|${escapeSlackText(link.label)}>`)
    .join(' · ');
  const body = [`*${escapeSlackText(title)}*`, escapeSlackText(text), linkLine]
    .filter(Boolean)
    .join('\n');
  return {
    text: `${title}: ${text}`.slice(0, 3_000),
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: body.slice(0, 3_000) } }],
  };
}

/** Adaptive card content (Teams escapes nothing in TextBlock, it renders a markdown subset). */
export function teamsTextCard(title: string, text: string, links: readonly ChatLink[] = []) {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'TextBlock', text, wrap: true },
    ],
    actions: safeLinks(links).map(link => ({
      type: 'Action.OpenUrl',
      title: link.label,
      url: link.url,
    })),
  };
}

/** Teams incoming-webhook / Workflows body: one adaptive-card attachment. */
export function teamsWebhookBody(title: string, text: string, links: readonly ChatLink[] = []) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: teamsTextCard(title, text, links),
      },
    ],
  };
}
