'use client';

import { useState } from 'react';
import { FormField, Switch } from '@/components/ui';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { Shield, AlertTriangle, Server, Clock, Info } from 'lucide-react';

export type PrivacySettings = {
  privacyMode: 'PUBLIC' | 'RESTRICTED' | 'PRIVATE' | 'CUSTOM';
  requireAuth: boolean;
  authProvider: string | null;
  showIncidentDetails: boolean;
  showIncidentTitles: boolean;
  showIncidentDescriptions: boolean;
  showAffectedServices: boolean;
  showIncidentTimestamps: boolean;
  showServiceMetrics: boolean;
  showServiceDescriptions: boolean;
  showServiceRegions: boolean;
  showTeamInformation: boolean;
  showCustomFields: boolean;
  showIncidentAssignees: boolean;
  showIncidentUrgency: boolean;
  showUptimeHistory: boolean;
  showRecentIncidents: boolean;
  showIncidentHistoryDetails?: boolean;
  incidentHistoryDetailDays?: number | null;
  maxIncidentsToShow: number;
  incidentHistoryDays: number;
  allowedCustomFields: string[];
  dataRetentionDays?: number | null;
};

interface StatusPagePrivacySettingsProps {
  settings: PrivacySettings;
  onChange: (settings: PrivacySettings) => void;
  customFields?: Array<{ id: string; name: string; key: string }>;
}

const PRIVACY_PRESETS = {
  PUBLIC: {
    label: 'Public',
    description: 'Show all information - recommended for transparency',
    settings: {
      showIncidentDetails: true,
      showIncidentTitles: true,
      showIncidentDescriptions: true,
      showAffectedServices: true,
      showIncidentTimestamps: true,
      showServiceMetrics: true,
      showServiceDescriptions: true,
      showServiceRegions: true,
      showTeamInformation: false,
      showCustomFields: false,
      showIncidentAssignees: false,
      showIncidentUrgency: true,
      showUptimeHistory: true,
      showRecentIncidents: true,
    },
  },
  RESTRICTED: {
    label: 'Restricted',
    description: 'Hide sensitive details but show general status information',
    settings: {
      showIncidentDetails: true,
      showIncidentTitles: true,
      showIncidentDescriptions: false,
      showAffectedServices: true,
      showIncidentTimestamps: true,
      showServiceMetrics: true,
      showServiceDescriptions: false,
      showServiceRegions: true,
      showTeamInformation: false,
      showCustomFields: false,
      showIncidentAssignees: false,
      showIncidentUrgency: true,
      showUptimeHistory: true,
      showRecentIncidents: true,
    },
  },
  PRIVATE: {
    label: 'Minimal details',
    description:
      'Minimal information - show only basic status. (To require sign-in, use Access control in General)',
    settings: {
      showIncidentDetails: false,
      showIncidentTitles: true,
      showIncidentDescriptions: false,
      showAffectedServices: true,
      showIncidentTimestamps: false,
      showServiceMetrics: true,
      showServiceDescriptions: false,
      showServiceRegions: false,
      showTeamInformation: false,
      showCustomFields: false,
      showIncidentAssignees: false,
      showIncidentUrgency: false,
      showUptimeHistory: false,
      showRecentIncidents: true,
    },
  },
  CUSTOM: {
    label: 'Custom',
    description: 'Mix and match individual settings',
    settings: {},
  },
};

export default function StatusPagePrivacySettings({
  settings,
  onChange,
}: StatusPagePrivacySettingsProps) {
  const [expandedPreset, setExpandedPreset] = useState<keyof typeof PRIVACY_PRESETS | null>(null);

  const PRESET_DETAIL_LABELS: Array<{ key: keyof PrivacySettings; label: string }> = [
    { key: 'showIncidentDetails', label: 'Timeline & progress updates' },
    { key: 'showIncidentDescriptions', label: 'Incident body description' },
    { key: 'showIncidentTimestamps', label: 'Incident timestamps' },
    { key: 'showAffectedServices', label: 'Affected services' },
    { key: 'showIncidentUrgency', label: 'Incident urgency' },
    { key: 'showServiceDescriptions', label: 'Service descriptions' },
    { key: 'showServiceRegions', label: 'Service regions' },
    { key: 'showUptimeHistory', label: 'Uptime history' },
    { key: 'showTeamInformation', label: 'Team ownership' },
  ];

  const getPresetSummary = (presetKey: keyof typeof PRIVACY_PRESETS) => {
    if (presetKey === 'CUSTOM') {
      return 'Custom mix of visibility settings';
    }
    const presetSettings = PRIVACY_PRESETS[presetKey].settings as Partial<PrivacySettings>;
    const shows: string[] = [];
    const hides: string[] = [];
    PRESET_DETAIL_LABELS.forEach(({ key, label }) => {
      const value = presetSettings[key];
      if (value === true) {
        shows.push(label);
      } else if (value === false) {
        hides.push(label);
      }
    });
    const showText = shows.length > 0 ? `Shows: ${shows.join(', ')}` : 'Shows: basic status only';
    const hideText = hides.length > 0 ? `Hides: ${hides.join(', ')}` : 'Hides: none';
    return `${showText}. ${hideText}.`;
  };

  const updateSetting = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => {
    const updated = { ...settings, [key]: value, privacyMode: 'CUSTOM' as const };
    onChange(updated);
  };

  const applyPreset = (preset: keyof typeof PRIVACY_PRESETS) => {
    const presetSettings = PRIVACY_PRESETS[preset];
    const updated: PrivacySettings = {
      ...settings,
      privacyMode: preset,
      ...presetSettings.settings,
    };
    onChange(updated);
  };

  return (
    <div className="space-y-6">
      {/* Privacy Mode Presets */}
      <StatusPageSectionCard
        title="Privacy Level"
        description="Choose a privacy preset or customize individual settings below."
        icon={<Shield className="h-4 w-4" />}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 'var(--spacing-3)',
          }}
        >
          {Object.entries(PRIVACY_PRESETS).map(([key, preset]) => (
            <div
              key={key}
              role="button"
              onClick={() => applyPreset(key as keyof typeof PRIVACY_PRESETS)}
              title={getPresetSummary(key as keyof typeof PRIVACY_PRESETS)}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  applyPreset(key as keyof typeof PRIVACY_PRESETS);
                }
              }}
              style={{
                padding: 'var(--spacing-4)',
                border: '2px solid',
                borderColor: settings.privacyMode === key ? 'var(--primary-color)' : '#e5e7eb',
                borderRadius: 'var(--radius-md)',
                background: settings.privacyMode === key ? '#f0f9ff' : 'white',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.2s ease',
                position: 'relative',
              }}
            >
              <div
                style={{
                  fontWeight: '600',
                  marginBottom: 'var(--spacing-1)',
                  color:
                    settings.privacyMode === key ? 'var(--primary-color)' : 'var(--text-primary)',
                }}
              >
                {preset.label}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                {preset.description}
              </div>
              <button
                type="button"
                onClick={event => {
                  event.stopPropagation();
                  setExpandedPreset(current =>
                    current === key ? null : (key as keyof typeof PRIVACY_PRESETS)
                  );
                }}
                style={{
                  marginTop: 'var(--spacing-2)',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  border: '1px solid #e5e7eb',
                  background: 'white',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: '600',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {expandedPreset === key ? 'Hide details' : 'View details'}
              </button>
              {expandedPreset === key && (
                <div
                  style={{
                    marginTop: 'var(--spacing-2)',
                    padding: 'var(--spacing-2)',
                    borderRadius: 'var(--radius-md)',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-muted)',
                    lineHeight: 1.5,
                  }}
                >
                  {getPresetSummary(key as keyof typeof PRIVACY_PRESETS)}
                </div>
              )}
            </div>
          ))}
        </div>
      </StatusPageSectionCard>

      {/* Incident Privacy Settings */}
      <StatusPageSectionCard
        title="Incident Information"
        description="Configure how much detail is exposed on incident reports and timeline updates."
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">
                Show Timeline & Progress Updates
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Chronological investigation and resolution updates
              </p>
            </div>
            <Switch
              checked={settings.showIncidentDetails}
              onChange={checked => updateSetting('showIncidentDetails', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Incident Titles</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Incident titles (falls back to generic title if off)
              </p>
            </div>
            <Switch
              checked={settings.showIncidentTitles}
              onChange={checked => updateSetting('showIncidentTitles', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">
                Show Incident Body Description
              </p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Descriptive paragraph explaining what occurred
              </p>
            </div>
            <Switch
              checked={settings.showIncidentDescriptions}
              onChange={checked => updateSetting('showIncidentDescriptions', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Affected Services</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Display which services are affected by incidents
              </p>
            </div>
            <Switch
              checked={settings.showAffectedServices}
              onChange={checked => updateSetting('showAffectedServices', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Incident Timestamps</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                When incidents occurred and were resolved
              </p>
            </div>
            <Switch
              checked={settings.showIncidentTimestamps}
              onChange={checked => updateSetting('showIncidentTimestamps', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Incident Urgency</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Urgency level (High/Medium/Low) for incidents
              </p>
            </div>
            <Switch
              checked={settings.showIncidentUrgency}
              onChange={checked => updateSetting('showIncidentUrgency', checked)}
            />
          </div>
        </div>
      </StatusPageSectionCard>

      {/* Service Information */}
      <StatusPageSectionCard
        title="Service Information"
        description="Control visibility of service descriptions, regions, metrics, and team ownership."
        icon={<Server className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Service Descriptions</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Display service descriptions and details
              </p>
            </div>
            <Switch
              checked={settings.showServiceDescriptions}
              onChange={checked => updateSetting('showServiceDescriptions', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Service Regions</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Display hosting regions for each service
              </p>
            </div>
            <Switch
              checked={settings.showServiceRegions}
              onChange={checked => updateSetting('showServiceRegions', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Uptime History</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Display historical uptime charts and timelines
              </p>
            </div>
            <Switch
              checked={settings.showUptimeHistory}
              onChange={checked => updateSetting('showUptimeHistory', checked)}
            />
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Team Information</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Display team names and ownership badges
              </p>
            </div>
            <Switch
              checked={settings.showTeamInformation}
              onChange={checked => updateSetting('showTeamInformation', checked)}
            />
          </div>
        </div>
      </StatusPageSectionCard>

      {/* Advanced Privacy Settings */}
      <StatusPageSectionCard
        title="Advanced Privacy Settings"
        description="Incident history windows, age-based redaction, and public retention caps."
        icon={<Clock className="h-4 w-4" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/15 hover:bg-muted/30 transition-colors">
            <div className="space-y-0.5 pr-2">
              <p className="text-xs font-semibold text-foreground">Show Incident History Details</p>
              <p className="text-[11px] text-muted-foreground leading-snug">
                When off, older resolved incidents show title only. Active incidents are never
                redacted.
              </p>
            </div>
            <Switch
              checked={settings.showIncidentHistoryDetails ?? true}
              onChange={checked =>
                updateSetting('showIncidentHistoryDetails' as never, checked as never)
              }
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {settings.showIncidentHistoryDetails === false && (
              <FormField
                type="input"
                label="Incident History Detail Window (days)"
                inputType="number"
                value={settings.incidentHistoryDetailDays?.toString() ?? ''}
                onChange={e =>
                  updateSetting(
                    'incidentHistoryDetailDays' as never,
                    (e.target.value ? parseInt(e.target.value) : null) as never
                  )
                }
                helperText="Resolved incidents older than this are redacted (1–365). Active incidents are never redacted."
              />
            )}
            <FormField
              type="input"
              label="Maximum Incidents to Show"
              inputType="number"
              value={settings.maxIncidentsToShow.toString()}
              onChange={e => {
                const next = Math.max(1, Math.min(100, parseInt(e.target.value) || 50));
                updateSetting('maxIncidentsToShow', next);
              }}
              helperText="Number of incidents in the public snapshot (1–100; full history is paginated)"
            />
            <FormField
              type="input"
              label="Public Incident History Window (days)"
              inputType="number"
              value={settings.incidentHistoryDays.toString()}
              onChange={e => updateSetting('incidentHistoryDays', parseInt(e.target.value) || 90)}
              helperText="Show resolved incidents from the last N days (1–365)"
            />
            <FormField
              type="input"
              label="Public History Retention Cap (days, optional)"
              inputType="number"
              value={settings.dataRetentionDays?.toString() || ''}
              onChange={e =>
                updateSetting('dataRetentionDays', e.target.value ? parseInt(e.target.value) : null)
              }
              helperText="Limits how far back the public Status Page and status APIs expose incident history."
            />
          </div>
        </div>
      </StatusPageSectionCard>

      {/* Privacy Summary */}
      <StatusPageSectionCard
        title="Privacy Summary"
        description="Overview of the active privacy mode and public projection scope."
        icon={<Info className="h-4 w-4" />}
      >
        <div className="p-4 bg-muted/40 rounded-lg border border-border/50 space-y-1">
          <div className="text-sm font-medium text-foreground">
            Current privacy mode:{' '}
            <span className="font-bold text-primary">{settings.privacyMode}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            These settings control what information is visible on your public status page. Changes
            take effect immediately after saving.
          </div>
        </div>
      </StatusPageSectionCard>
    </div>
  );
}
