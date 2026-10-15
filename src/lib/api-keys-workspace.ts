export const WORKSPACE_TABS = ['api-keys', 'service-accounts', 'explorer', 'activity'] as const;
export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number];

export function normalizeWorkspaceTab(raw: string | null | undefined): WorkspaceTabId | undefined {
  if (!raw) return undefined;
  const normalized = raw === 'api-explorer' ? 'explorer' : raw;
  return (WORKSPACE_TABS as readonly string[]).includes(normalized)
    ? (normalized as WorkspaceTabId)
    : undefined;
}
