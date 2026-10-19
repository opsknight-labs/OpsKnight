'use client';
import { useEffect, useState } from 'react';
import type { RunbookInput } from '@prisma/client';
export type VersionConfiguration = { id: string; inputs: RunbookInput[]; hasAgentWrite: boolean };
export function useVersionConfiguration(versionId: string | null | undefined, runbookId?: string) {
  const [result, setResult] = useState<{
    key: string;
    data: VersionConfiguration | null;
    error: boolean;
  } | null>(null);
  const key = `${runbookId}:${versionId}`;
  useEffect(() => {
    if (!versionId || !runbookId) return;
    const abort = new AbortController();
    fetch(
      `/api/runbooks/versions/${encodeURIComponent(versionId)}/configuration?runbookId=${encodeURIComponent(runbookId)}`,
      { signal: abort.signal }
    )
      .then(async response => {
        if (!response.ok) throw new Error('Version configuration unavailable');
        return response.json();
      })
      .then(response => {
        if (!abort.signal.aborted) setResult({ key, data: response.data, error: false });
      })
      .catch(() => {
        if (!abort.signal.aborted) setResult({ key, data: null, error: true });
      });
    return () => abort.abort();
  }, [versionId, runbookId, key]);
  return result?.key === key ? result : { data: null, error: false };
}
