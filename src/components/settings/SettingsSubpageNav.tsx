'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { SETTINGS_NAV_SECTIONS } from '@/components/settings/navConfig';
import SettingsSearchTrigger from '@/components/settings/SettingsSearchTrigger';

export default function SettingsSubpageNav() {
  const pathname = usePathname();

  // Do not render breadcrumbs on the settings overview page itself
  if (!pathname || pathname === '/settings') {
    return null;
  }

  // Find the current item and section from navConfig
  let currentItem = null;
  let currentSection = null;

  for (const section of SETTINGS_NAV_SECTIONS) {
    for (const item of section.items) {
      if (
        pathname === item.href ||
        (item.href !== '/settings' && pathname.startsWith(`${item.href}/`))
      ) {
        currentItem = item;
        currentSection = section;
        break;
      }
    }
    if (currentItem) break;
  }

  const isDeepChild = Boolean(currentItem && pathname !== currentItem.href);
  const pageTitle = currentItem?.label ?? 'Settings Detail';
  const sectionTitle = currentSection?.label;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-5 mb-6 border-b border-border/60">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap"
      >
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 font-medium hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Settings</span>
        </Link>

        {sectionTitle && (
          <>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            <span className="text-muted-foreground/70 hidden md:inline">{sectionTitle}</span>
          </>
        )}

        {isDeepChild ? (
          <>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            <Link
              href={currentItem?.href || '/settings'}
              className="font-medium hover:text-foreground transition-colors"
            >
              {pageTitle}
            </Link>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            <span className="font-semibold text-foreground truncate max-w-[240px] sm:max-w-none">
              Detail
            </span>
          </>
        ) : (
          <>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            <span className="font-semibold text-foreground truncate max-w-[240px] sm:max-w-none">
              {pageTitle}
            </span>
          </>
        )}
      </nav>

      <div className="flex items-center gap-2">
        <SettingsSearchTrigger />
      </div>
    </div>
  );
}
