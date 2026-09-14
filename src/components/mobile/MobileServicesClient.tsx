'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Server } from 'lucide-react';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import EmptyState from '@/components/ui/EmptyState';
import { Card } from '@/components/ui/shadcn/card';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import { haptics } from '@/lib/haptics';
import { appRoutes } from '@/lib/app-routes';

type ServiceItem = {
  id: string;
  name: string;
  description: string | null;
  _count: { incidents: number };
};

export default function MobileServicesClient({
  initialServices,
  query,
}: {
  initialServices: ServiceItem[];
  query: string;
}) {
  const cacheKey = `mobile-services:${query || 'all'}`;
  const [services, setServices] = useState<ServiceItem[]>(initialServices);
  const [cachedAt, setCachedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;

    const handleOnlineStatus = async () => {
      if (!navigator.onLine) {
        const [cached, status] = await Promise.all([
          readCache<ServiceItem[]>(cacheKey),
          Promise.resolve(readMobileCacheStatus(cacheKey)),
        ]);
        if (cancelled) return;
        if (cached && Array.isArray(cached)) {
          setServices(cached);
          setCachedAt(status?.savedAt ?? null);
        }
      } else {
        setServices(initialServices);
        setCachedAt(null);
      }
    };

    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);
    void handleOnlineStatus();
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, [cacheKey, initialServices]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) {
      void writeCache(cacheKey, initialServices);
    }
  }, [cacheKey, initialServices]);

  const operationalCount = services.filter(service => service._count.incidents === 0).length;
  const impactedCount = services.length - operationalCount;

  return (
    <div className="responsive-page space-y-4">
      <MobileCachedDataNotice savedAt={cachedAt} />
      <section className="flex items-center justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
        <span>{services.length} {services.length === 1 ? 'service' : 'services'}</span>
        <span>
          <strong className="font-semibold text-foreground">{impactedCount}</strong> impacted ·{' '}
          <strong className="font-semibold text-foreground">{operationalCount}</strong> operational
        </span>
      </section>

      <MobileSearchWithParams placeholder="Search services" />

      {services.length === 0 ? (
        <EmptyState
          icon={<Server aria-hidden="true" />}
          title={query ? 'No matching services' : 'No services available'}
          description={query ? `Nothing matches “${query}”.` : 'Services you can access will appear here.'}
          size="sm"
        />
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card shadow-none">
          {services.map((service, index) => {
            const openIncidents = service._count.incidents;
            const impacted = openIncidents > 0;
            return (
              <Link
                key={service.id}
                href={appRoutes.service('mobile', service.id)}
                onClick={() => haptics.soft()}
                className={`flex min-h-[68px] min-w-0 items-center gap-3 px-3.5 py-3 text-card-foreground transition-colors hover:bg-accent/40 ${index > 0 ? 'border-t border-border/70' : ''}`}
              >
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${impacted ? 'bg-rose-500' : 'bg-emerald-500'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{service.name}</span>
                    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${impacted ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-300'}`}>
                      {impacted ? 'Impacted' : 'Operational'}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {impacted ? `${openIncidents} active incident${openIncidents === 1 ? '' : 's'}` : service.description || 'No active incidents'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
