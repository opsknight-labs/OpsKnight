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

export function teamsActionError(statusCode: number, code: string, message: string): TeamsInvokeResponse {
  return {
    statusCode,
    type: 'application/vnd.microsoft.error',
    value: { code, message, innerHttpError: { statusCode, body: { error: message } } },
  };
}
