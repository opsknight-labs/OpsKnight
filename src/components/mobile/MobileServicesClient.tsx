'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { MobileSearchWithParams } from '@/components/mobile/MobileSearchParams';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { haptics } from '@/lib/haptics';

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnlineStatus = async () => {
      if (!navigator.onLine) {
        const cached = await readCache<ServiceItem[]>(cacheKey);
        if (cached && Array.isArray(cached) && cached.length > 0) {
          setServices(cached);
        }
      } else {
        setServices(initialServices);
      }
    };

    window.addEventListener('online', handleOnlineStatus);
    window.addEventListener('offline', handleOnlineStatus);

    // Initial check
    void handleOnlineStatus();

    return () => {
      window.removeEventListener('online', handleOnlineStatus);
      window.removeEventListener('offline', handleOnlineStatus);
    };
  }, [cacheKey, initialServices]);

  useEffect(() => {
    if (typeof window !== 'undefined' && navigator.onLine) {
      writeCache(cacheKey, initialServices);
    }
  }, [cacheKey, initialServices]);

  const healthyCount = services.filter(service => service._count.incidents === 0).length;
  const degradedCount = services.filter(service => service._count.incidents > 0).length;

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          Services
        </h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          {healthyCount} healthy · {degradedCount} with issues
        </p>
      </div>

      <MobileSearchWithParams placeholder="Search services..." />

      <div className="flex flex-col gap-3">
        {services.length === 0 ? (
          <EmptyState />
        ) : (
          services.map(service => (
            <ServiceCard
              key={service.id}
              service={service}
              openIncidents={service._count.incidents}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ServiceCard({
  service,
  openIncidents,
}: {
  service: { id: string; name: string; description: string | null };
  openIncidents: number;
}) {
  const isHealthy = openIncidents === 0;

  return (
    <Link
      href={`/m/services/${service.id}`}
      onClick={() => haptics.soft()}
      className="flex items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-4 text-[color:var(--text-primary)] shadow-sm transition hover:bg-[color:var(--bg-secondary)]"
    >
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <div
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            isHealthy
              ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
              : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
          }`}
        />

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{service.name}</div>
          {service.description && (
            <div className="truncate text-xs text-[color:var(--text-secondary)]">
              {service.description}
            </div>
          )}
        </div>
      </div>

      {openIncidents > 0 && (
        <span className="rounded-full bg-red-100 px-2 py-1 text-[10px] font-bold uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">
          {openIncidents} active
        </span>
      )}

      <ChevronRight className="h-4 w-4 text-[color:var(--text-muted)]" />
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-6 py-10 text-center">
      <div className="text-3xl">{'\u{1F527}'}</div>
      <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">No services</h3>
      <p className="text-xs text-[color:var(--text-muted)]">Use desktop to create services</p>
    </div>
  );
}
