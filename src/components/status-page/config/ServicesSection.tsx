'use client';
/* eslint-disable security/detect-object-injection */

import StatusPageBusinessLayout from '@/components/status-page/StatusPageBusinessLayout';
import { setBusinessServiceOverrideAction } from '@/app/(app)/settings/status-pages/[pageId]/business-service-actions';
import { orderedServiceIds, reorderGroupMembers } from '@/lib/status-pages/service-order';
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
    allServices,
    serviceConfigs,
    setServiceConfigs,
    updateServiceConfig,
    expandGroupsByDefault,
    setExpandGroupsByDefault,
  } = ctx;
  // One page order drives the flat list and every group's member order.
  const pageOrder = orderedServiceIds(selectedServices, id => serviceConfigs[id]?.order);
  const names = new Map(allServices.map(service => [service.id, service.name]));
  const members = Object.fromEntries(
    pageOrder.map(
      (id, position) =>
        [
          id,
          {
            name: serviceConfigs[id]?.displayName || names.get(id) || id,
            shown: serviceConfigs[id]?.showOnPage !== false,
            position,
          },
        ] as const
    )
  );
  return (
    <StatusPageBusinessLayout
      layout={serviceLayout}
      onLayoutChange={setServiceLayout}
      businessServices={allBusinessServices ?? []}
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
      expandGroupsByDefault={expandGroupsByDefault}
      onExpandGroupsByDefaultChange={setExpandGroupsByDefault}
      members={members}
      onMemberShownChange={(id, shown) => updateServiceConfig(id, { showOnPage: shown })}
      onMembersReorder={(_group, ids) => {
        const next = reorderGroupMembers(pageOrder, ids);
        // Renumber in steps of 10, like the flat list's auto-order, so the order is unambiguous.
        setServiceConfigs(current => {
          const updated = { ...current };
          next.forEach((id, index) => {
            updated[id] = {
              displayName: current[id]?.displayName ?? '',
              showOnPage: current[id]?.showOnPage !== false,
              order: (index + 1) * 10,
            };
          });
          return updated;
        });
      }}
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
