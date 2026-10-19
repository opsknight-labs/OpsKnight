'use client';

export async function authenticationRequest<T>(
  payload: unknown,
  endpoint = '/api/auth/control'
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    credentials: 'same-origin',
    signal: AbortSignal.timeout(30000),
  });
  const data = (await response.json()) as { data: T; error?: string };
  if (!response.ok) throw new Error(data.error ?? 'Authentication operation failed.');
  return data.data;
}

export async function loadAuthenticationAlertHistory(
  status: NonNullable<
    Parameters<typeof import('@/lib/auth-control/dashboard').authenticationAlertHistory>[0]
  >,
  after?: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ view: 'alerts', status });
  if (after) query.set('after', after);
  const response = await fetch(`/api/auth/control?${query}`, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Delivery history unavailable.');
  return body.data as Awaited<
    ReturnType<typeof import('@/lib/auth-control/dashboard').authenticationAlertHistory>
  >;
}
