'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

type ServiceTabsProps = {
  serviceId: string;
};

export default function ServiceTabs({ serviceId }: ServiceTabsProps) {
  const pathname = usePathname();

  const basePath = `/services/${serviceId}`;
  const activeHref = pathname.startsWith(`${basePath}/integrations`)
    ? `${basePath}/integrations`
    : pathname.startsWith(`${basePath}/settings`) || pathname.startsWith(`${basePath}/webhooks`)
      ? `${basePath}/settings`
      : basePath;

  const tabs = [
    { href: `/services/${serviceId}`, label: 'Overview' },
    { href: `/services/${serviceId}/integrations`, label: 'Integrations' },
    { href: `/services/${serviceId}/settings`, label: 'Settings' },
  ];

  return (
    <div className="flex items-center gap-6 border-b border-slate-200 mb-8">
      {tabs.map(tab => {
        const isActive = activeHref === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'pb-3 pt-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
