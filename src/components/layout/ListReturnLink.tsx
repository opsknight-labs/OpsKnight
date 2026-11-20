'use client';

import { forwardRef, useCallback, useSyncExternalStore, type ComponentProps } from 'react';
import Link from 'next/link';
import { getListReturnHref, LIST_RETURN_CHANGE_EVENT } from '@/lib/navigation/list-return';

function subscribe(onChange: () => void) {
  window.addEventListener(LIST_RETURN_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(LIST_RETURN_CHANGE_EVENT, onChange);
}

/** `href` with the list's remembered filters when it points at a list page (client only). */
export function useListReturnHref(href: string): string {
  const getSnapshot = useCallback(() => getListReturnHref(href), [href]);
  const getServerSnapshot = useCallback(() => href, [href]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

type ListReturnLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

/** A `Link` back to a list page that returns to the list's last filtered view. */
const ListReturnLink = forwardRef<HTMLAnchorElement, ListReturnLinkProps>(function ListReturnLink(
  { href, ...props },
  ref
) {
  const resolved = useListReturnHref(href);
  return <Link ref={ref} href={resolved} {...props} />;
});

export default ListReturnLink;
