'use client';

export const MOBILE_PRINCIPAL_MARKER_ID = 'opsknight-mobile-principal';

export type MobilePrincipalContext = {
  principalId: string;
  authGeneration: string;
};

export function readMobilePrincipalContext(): MobilePrincipalContext | null {
  if (typeof document === 'undefined') return null;
  const marker = document.getElementById(MOBILE_PRINCIPAL_MARKER_ID);
  const principalId = marker?.dataset.principalId?.trim();
  const authGeneration = marker?.dataset.authGeneration?.trim();
  if (!principalId || !authGeneration) return null;
  return { principalId, authGeneration };
}

export function principalStorageSegment(context: MobilePrincipalContext): string {
  return `${encodeURIComponent(context.principalId)}:${encodeURIComponent(context.authGeneration)}`;
}

export function deriveOfflineLaneKey(
  operation: string,
  url: string,
  principalId: string
): string {
  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://local.invalid');
    const incidentMatch = parsed.pathname.match(/\/api\/(?:mobile\/)?incidents\/([^/]+)\/status$/);
    if (operation === 'INCIDENT_STATUS' && incidentMatch?.[1]) {
      return `incident:${decodeURIComponent(incidentMatch[1])}`;
    }
    if (operation === 'NOTIFICATION_STATE') return `notifications:${principalId}`;
    return `request:${parsed.pathname}`;
  } catch {
    return `request:${operation}:${principalId}`;
  }
}
