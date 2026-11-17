'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  getListReturnHref,
  isListReturnNavigation,
  rememberListUrl,
} from '@/lib/navigation/list-return';

/**
 * Shell-level list return: records each list page's query string as it changes, and makes
 * in-page links that go "up" from a detail page to its list (back links, hero breadcrumbs)
 * return to the remembered filtered view. Links rendered with `ListReturnLink` already carry
 * the query and pass through untouched; the sidebar and ⌘K palette still open a fresh list.
 */
export default function ListReturnTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const search = searchParams?.toString() ?? '';

  useEffect(() => {
    rememberListUrl(pathname, search);
  }, [pathname, search]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      if (!anchor.closest('#main-content')) return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const href = `${url.pathname}${url.search}${url.hash}`;
      if (!isListReturnNavigation(window.location.pathname, href)) return;

      const restored = getListReturnHref(href);
      if (restored === href) return;
      event.preventDefault();
      router.push(restored);
    };

    // Capture phase runs before Next's Link handler, which skips prevented clicks.
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [router]);

  return null;
}
