'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Fragment } from 'react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
  BreadcrumbEllipsis,
} from '@/components/ui/shadcn/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { cn } from '@/lib/utils';

export default function TopbarBreadcrumbs() {
  const pathname = usePathname();

  // Don't show breadcrumbs on home page
  if (pathname === '/') {
    return null;
  }

  const segments = pathname.split('/').filter(Boolean);

  const breadcrumbs = segments.map((segment, index) => {
    const href = '/' + segments.slice(0, index + 1).join('/');
    const isId =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        segment
      ) ||
      (segment.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(segment)) ||
      /^c[a-z0-9]{16,}$/i.test(segment);

    const label = isId
      ? segment
      : segment
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

    return {
      href,
      label,
      isId,
      isLast: index === segments.length - 1,
    };
  });

  return (
    <Breadcrumb className="hidden md:flex">
      <BreadcrumbList className="flex-nowrap whitespace-nowrap text-xs text-zinc-400">
        <BreadcrumbItem>
          <BreadcrumbLink
            asChild
            className="text-zinc-400 hover:text-zinc-100 transition-colors text-xs font-medium"
          >
            <Link href="/">Home</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {breadcrumbs.length > 2 ? (
          <>
            <Fragment>
              <BreadcrumbSeparator className="text-zinc-600 [&>svg]:size-3" />
              <BreadcrumbItem>
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex items-center gap-1 text-zinc-400 hover:text-zinc-100 transition-colors">
                    <BreadcrumbEllipsis className="h-4 w-4 text-zinc-400 hover:text-zinc-100" />
                    <span className="sr-only">Toggle menu</span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="bg-[#18181b] border-zinc-800 text-zinc-200 shadow-xl"
                  >
                    {breadcrumbs.slice(0, -2).map(breadcrumb => (
                      <DropdownMenuItem
                        key={breadcrumb.href}
                        asChild
                        className="focus:bg-zinc-800 focus:text-zinc-100 text-xs"
                      >
                        <Link href={breadcrumb.href} title={breadcrumb.label}>
                          {breadcrumb.label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </BreadcrumbItem>
            </Fragment>
            {breadcrumbs.slice(-2).map(breadcrumb => (
              <Fragment key={breadcrumb.href}>
                <BreadcrumbSeparator className="text-zinc-600 [&>svg]:size-3" />
                <BreadcrumbItem>
                  {breadcrumb.isLast ? (
                    <BreadcrumbPage
                      className={cn(
                        'text-zinc-100 font-medium text-xs truncate max-w-[240px]',
                        breadcrumb.isId &&
                          'font-mono text-[11px] font-normal px-1.5 py-0.5 rounded bg-zinc-800/90 border border-zinc-700/70 text-zinc-200 tracking-tight'
                      )}
                      title={breadcrumb.label}
                    >
                      {breadcrumb.label}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      asChild
                      className={cn(
                        'text-zinc-400 hover:text-zinc-100 transition-colors text-xs font-medium',
                        breadcrumb.isId &&
                          'font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 hover:text-zinc-100'
                      )}
                    >
                      <Link href={breadcrumb.href} title={breadcrumb.label}>
                        {breadcrumb.label}
                      </Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </>
        ) : (
          breadcrumbs.map(breadcrumb => (
            <Fragment key={breadcrumb.href}>
              <BreadcrumbSeparator className="text-zinc-600 [&>svg]:size-3" />
              <BreadcrumbItem>
                {breadcrumb.isLast ? (
                  <BreadcrumbPage
                    className={cn(
                      'text-zinc-100 font-medium text-xs truncate max-w-[240px]',
                      breadcrumb.isId &&
                        'font-mono text-[11px] font-normal px-1.5 py-0.5 rounded bg-zinc-800/90 border border-zinc-700/70 text-zinc-200 tracking-tight'
                    )}
                    title={breadcrumb.label}
                  >
                    {breadcrumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    asChild
                    className={cn(
                      'text-zinc-400 hover:text-zinc-100 transition-colors text-xs font-medium',
                      breadcrumb.isId &&
                        'font-mono text-[11px] px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 hover:text-zinc-100'
                    )}
                  >
                    <Link href={breadcrumb.href} title={breadcrumb.label}>
                      {breadcrumb.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
