'use client';
import { useEffect, useRef, useState } from 'react';
import type { DiagnosticPage, DiagnosticQuery } from '@/lib/auth-control/diagnostic-contract';

export async function loadDiagnosticPage(
  query: DiagnosticQuery,
  signal: AbortSignal
): Promise<DiagnosticPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value != null && value !== '') params.set(key, String(value));
  const response = await fetch(`/api/auth/control/diagnostics?${params}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'This diagnostic page could not be loaded.');
  return body.data;
}
export function useDiagnosticPage(query: DiagnosticQuery) {
  const key = JSON.stringify(query);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    phase: 'loading' | 'ready' | 'error';
    page?: DiagnosticPage;
    error?: string;
  }>({ key, phase: 'loading' });
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++generation.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the pending phase of this external request while retaining its current page.
    setResult(previous => ({
      key,
      phase: 'loading',
      page: previous.key === key ? previous.page : undefined,
    }));
    void loadDiagnosticPage(JSON.parse(key) as DiagnosticQuery, controller.signal)
      .then(page => {
        if (!controller.signal.aborted && generation.current === request)
          setResult({ key, phase: 'ready', page });
      })
      .catch(error => {
        if (!controller.signal.aborted && generation.current === request)
          setResult(previous => ({
            key,
            phase: 'error',
            page: previous.key === key ? previous.page : undefined,
            error: error instanceof Error ? error.message : 'Diagnostics unavailable.',
          }));
      });
    return () => controller.abort();
  }, [key, refreshVersion]);
  return {
    page: result.key === key ? result.page : undefined,
    loading: result.key !== key || result.phase === 'loading',
    error: result.key === key ? result.error : undefined,
    refresh: () => setRefreshVersion(value => value + 1),
  };
}
