'use client';

import { useEffect, useState } from 'react';
import { isSearchResult, type SearchResult } from './palette-model';

export const SEARCH_DEBOUNCE_MS = 150;
export const MIN_SEARCH_LENGTH = 2;

type Response = {
  term: string;
  attempt: number;
  results: SearchResult[];
  failed: boolean;
  /** The server answered 429: the caller is being rate limited, not out of results. */
  limited: boolean;
};

/**
 * Debounced `/api/search` lookup. Each new term aborts the in-flight request, and results
 * are keyed by the term that produced them, so a slow stale response can never show up
 * under a newer query.
 */
export function useEntitySearch(query: string) {
  const term = query.trim();
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<Response>({
    term: '',
    attempt: 0,
    results: [],
    failed: false,
    limited: false,
  });

  useEffect(() => {
    if (term.length < MIN_SEARCH_LENGTH) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!controller.signal.aborted) {
            setResponse({ term, attempt, results: [], failed: true, limited: res.status === 429 });
          }
          return;
        }
        const data = (await res.json()) as { results?: unknown };
        const results = Array.isArray(data?.results) ? data.results.filter(isSearchResult) : [];
        if (!controller.signal.aborted) {
          setResponse({ term, attempt, results, failed: false, limited: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setResponse({ term, attempt, results: [], failed: true, limited: false });
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, attempt]);

  const active = term.length >= MIN_SEARCH_LENGTH;
  const settled = active && response.term === term && response.attempt === attempt;
  return {
    results: settled ? response.results : [],
    loading: active && !settled,
    failed: settled && response.failed,
    limited: settled && response.limited,
    /** Run the same search again (after a failure or a rate limit). */
    retry: () => setAttempt(count => count + 1),
  };
}
