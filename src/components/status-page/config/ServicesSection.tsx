'use client';
/* eslint-disable security/detect-object-injection */

import StatusPageBusinessLayout from '@/components/status-page/StatusPageBusinessLayout';
import { setBusinessServiceOverrideAction } from '@/app/(app)/settings/status-pages/[pageId]/business-service-actions';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function ServicesSection({ ctx }: { ctx: StatusPageConfigState }) {
  const {
    serviceLayout,
    setServiceLayout,
    allBusinessServices,
    businessServiceIds,
    businessServiceConfigs,
    setBusinessServiceConfigs,
    businessServiceOverrides,
    statusPage,
    router,
    setBusinessServiceIds,
    selectedServices,
    setSelectedServices,
  } = ctx;
  return (
    <StatusPageBusinessLayout
      layout={serviceLayout}
      onLayoutChange={setServiceLayout}
      businessServices={allBusinessServices}
      selectedIds={businessServiceIds}
      configs={businessServiceConfigs}
      onConfigChange={(id, patch) =>
        setBusinessServiceConfigs(current => ({
          ...current,
          [id]: {
            ...(current[id] ?? {
              displayName: '',
              showOnPage: true,
              showMembers: true,
            }),
            ...patch,
          },
        }))
      }
      overrides={businessServiceOverrides}
      onOverride={async (id, next) => {
        const failure = await setBusinessServiceOverrideAction(statusPage.id, id, next);
        if (!failure) router.refresh();
        return failure;
      }}
      onSelectedIdsChange={ids => {
        setBusinessServiceIds(ids);
        // Members are published with their business service; mirror that here.
        const added = allBusinessServices
          .filter(item => ids.includes(item.id))
          .flatMap(item => item.memberServiceIds);
        if (added.some(id => !selectedServices.has(id)))
          setSelectedServices(prev => new Set([...prev, ...added]));
      }}
    />
  );
}
