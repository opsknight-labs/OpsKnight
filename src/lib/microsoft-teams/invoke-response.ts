export type TeamsInvokeResponse = {
  statusCode: number;
  type: string;
  value: unknown;
};

export function teamsActionSuccess(message: string): TeamsInvokeResponse {
  return { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: message };
}

export function teamsActionCard(card: Record<string, unknown>): TeamsInvokeResponse {
  return { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card };
}

export function teamsActionError(
  statusCode: number,
  code: string,
  message: string
): TeamsInvokeResponse {
  return {
    statusCode,
    type: 'application/vnd.microsoft.error',
    value: { code, message, innerHttpError: { statusCode, body: { error: message } } },
  };
}

/**
 * Unlinked clicker: a card with a "Link your account" button (not a bare URL in a toast). The card
 * replaces the clicker's own view only; `backAction` (a refresh Action.Execute) restores the
 * incident card once they have linked.
 */
export function teamsActionLoginRequest(
  url: string,
  text = 'Link your OpsKnight account, then retry this action.',
  backAction?: Record<string, unknown>
): TeamsInvokeResponse {
  const safe = /^https?:\/\/[^\s"<>]+$/i.test(url) ? url : null;
  const message = text.replace(/:?\s*https?:\/\/\S+\s*$/, '').trim() || text;
  return teamsActionCard({
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    fallbackText: safe ? `${message} ${safe}` : message,
    body: [
      { type: 'TextBlock', text: 'Link your OpsKnight account', weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: message, wrap: true, isSubtle: true, spacing: 'Small' },
    ],
    actions: [
      ...(safe ? [{ type: 'Action.OpenUrl', title: 'Link your account', url: safe }] : []),
      ...(backAction ? [{ ...backAction, title: 'Back to incident' }] : []),
    ],
  });
}
