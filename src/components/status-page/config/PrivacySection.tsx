'use client';

import StatusPagePrivacySettings from '@/components/status-page/StatusPagePrivacySettings';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function PrivacySection({ ctx }: { ctx: StatusPageConfigState }) {
  const { privacySettings, setPrivacySettings, setFormData } = ctx;
  return (
    <StatusPagePrivacySettings
      settings={privacySettings}
      onChange={settings => {
        setPrivacySettings(settings);
        setFormData(prev => ({
          ...prev,
          ...(settings.showTeamInformation !== undefined
            ? { showServiceOwners: settings.showTeamInformation }
            : {}),
          ...(settings.showServiceRegions === false
            ? { showServicesByRegion: false, showRegionHeatmap: false }
            : {}),
          ...(settings.showServiceMetrics !== undefined
            ? { showMetrics: settings.showServiceMetrics }
            : {}),
          ...(settings.showRecentIncidents !== undefined
            ? { showIncidents: settings.showRecentIncidents }
            : {}),
        }));
      }}
    />
  );
}
