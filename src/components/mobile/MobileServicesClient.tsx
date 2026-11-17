'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Server, Wrench } from 'lucide-react';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import MobileCachedDataNotice from '@/components/mobile/MobileCachedDataNotice';
import {
  MobileListCard,
  MobileListMeta,
  MobileListRow,
  MobileStatusDot,
  MobileToneBadge,
} from '@/components/mobile/MobileList';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { readMobileCacheStatus } from '@/lib/mobile-cache-status';
import { haptics } from '@/lib/haptics';
import { appRoutes } from '@/lib/app-routes';

type ServiceItem = {
  id: string;
  name: string;
  description: string | null;
  _count: { incidents: number };
  maintenanceTitle?: string | null;
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
      <MobileListMeta
        trailing={
          <>
            <strong className="font-semibold text-foreground">{impactedCount}</strong> impacted ·{' '}
            <strong className="font-semibold text-foreground">{operationalCount}</strong>{' '}
            operational
          </>
        }
      >
        {services.length} {services.length === 1 ? 'service' : 'services'}
      </MobileListMeta>

      <MobileSearchWithParams placeholder="Search services" />

      {services.length === 0 ? (
        <EmptyState
          icon={<Server aria-hidden="true" />}
          title={query ? 'No matching services' : 'No services yet'}
          description={
            query
              ? `Nothing matches “${query}”. Check the spelling or clear the search.`
              : 'Services group the alerts and incidents your teams own. Create them from the desktop workspace.'
          }
          size="sm"
          action={
            query ? (
              <Button asChild variant="outline" size="lg" className="h-11 rounded-xl">
                <Link href="/m/services">Clear search</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <MobileListCard label="Services">
          {services.map(service => {
            const openIncidents = service._count.incidents;
            const impacted = openIncidents > 0;
            return (
              <MobileListRow
                key={service.id}
                href={appRoutes.service('mobile', service.id)}
                onClick={() => haptics.soft()}
                leading={<MobileStatusDot tone={impacted ? 'critical' : 'ok'} />}
                title={service.name}
                subtitle={
                  impacted
                    ? `${openIncidents} active incident${openIncidents === 1 ? '' : 's'}`
                    : service.description || 'No active incidents'
                }
                trailing={
                  service.maintenanceTitle ? (
                    <MobileToneBadge tone="info" icon={Wrench}>
                      Maintenance
                    </MobileToneBadge>
                  ) : impacted ? (
                    <MobileToneBadge tone="critical" icon={AlertTriangle}>
                      Impacted
                    </MobileToneBadge>
                  ) : (
                    <MobileToneBadge tone="ok" icon={CheckCircle2}>
                      Operational
                    </MobileToneBadge>
                  )
                }
              />
            );
          })}
        </MobileListCard>
      )}
    </div>
  );
}
