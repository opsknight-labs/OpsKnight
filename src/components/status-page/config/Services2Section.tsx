'use client';

import StatusPageServicesManager from '@/components/status-page/StatusPageServicesManager';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function Services2Section({ ctx }: { ctx: StatusPageConfigState }) {
  const {
    allServices,
    selectedServices,
    setSelectedServices,
    serviceConfigs,
    updateServiceConfig,
    formData,
    setFormData,
    privacySettings,
    setPrivacySettings,
    hasSelectedRegions,
    statusPage,
  } = ctx;
  const viaBusinessServiceIds = new Set(
    statusPage.services.filter(row => row.viaBusinessService).map(row => row.serviceId)
  );
  return (
    <StatusPageServicesManager
      allServices={allServices}
      selectedServices={selectedServices}
      setSelectedServices={setSelectedServices}
      serviceConfigs={serviceConfigs}
      updateServiceConfig={updateServiceConfig}
      formData={formData}
      setFormData={setFormData}
      privacySettings={privacySettings}
      setPrivacySettings={setPrivacySettings}
      hasSelectedRegions={hasSelectedRegions}
      viaBusinessServiceIds={viaBusinessServiceIds}
    />
  );
}
