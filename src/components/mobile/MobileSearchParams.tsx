'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import MobileSearch from './MobileSearch';

import { useRef, useState, useEffect } from 'react';

// Helper to debounce manually if package not available
function useDebounce<A extends unknown[]>(callback: (...args: A) => void, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (...args: A) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  };
}

export function MobileSearchWithParams({
  placeholder = 'Search...',
  basePath,
}: {
  placeholder?: string;
  basePath?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.get('q') || '';
  const [term, setTerm] = useState(currentQuery);
  // Follow URL changes (back/forward) by adjusting state during render, not in an effect.
  const [syncedQuery, setSyncedQuery] = useState(currentQuery);
  if (syncedQuery !== currentQuery) {
    setSyncedQuery(currentQuery);
    setTerm(currentQuery);
  }

  const handleSearch = useDebounce((searchTerm: string) => {
    const params = new URLSearchParams(searchParams);
    if (searchTerm) {
      params.set('q', searchTerm);
    } else {
      params.delete('q');
    }
    const path = basePath || window.location.pathname;
    const query = params.toString();
    router.replace(query ? `${path}?${query}` : path);
  }, 500);

  return (
    <MobileSearch
      placeholder={placeholder}
      value={term}
      onChange={val => {
        setTerm(val);
        handleSearch(val);
      }}
    />
  );
}
