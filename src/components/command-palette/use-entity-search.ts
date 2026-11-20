'use client';

import { useEffect, useState } from 'react';
import { isSearchResult, type SearchResult } from './palette-model';

export const SEARCH_DEBOUNCE_MS = 150;
export const MIN_SEARCH_LENGTH = 2;

type Response = { term: string; results: SearchResult[]; failed: boolean };

/**
 * Debounced `/api/search` lookup. Each new term aborts the in-flight request, and results
 * are keyed by the term that produced them, so a slow stale response can never show up
 * under a newer query.
 */
export function useEntitySearch(query: string) {
  const term = query.trim();
  const [response, setResponse] = useState<Response>({ term: '', results: [], failed: false });

  useEffect(() => {
    if (term.length < MIN_SEARCH_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Search failed with ${res.status}`);
        const data = (await res.json()) as { results?: unknown };
        const results = Array.isArray(data?.results) ? data.results.filter(isSearchResult) : [];
        if (!controller.signal.aborted) setResponse({ term, results, failed: false });
      } catch {
        if (!controller.signal.aborted) setResponse({ term, results: [], failed: true });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  const active = term.length >= MIN_SEARCH_LENGTH;
  const settled = active && response.term === term;
  return {
    results: settled ? response.results : [],
    loading: active && !settled,
    failed: settled && response.failed,
  };
}
