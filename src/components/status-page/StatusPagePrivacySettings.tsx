'use client';

import { useState } from 'react';
import { Card, FormField, Switch } from '@/components/ui';

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
    label: 'Private',
    description: 'Minimal information - show only basic status',
    settings: {
      showIncidentDetails: false,
      showIncidentTitles: true,
      showIncidentDescriptions: false,
      showAffectedServices: true,
      showIncidentTimestamps: false,
      showServiceMetrics: false,
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
  customFields = [],
}: StatusPagePrivacySettingsProps) {
  const [expandedPreset, setExpandedPreset] = useState<keyof typeof PRIVACY_PRESETS | null>(null);

  const PRESET_DETAIL_LABELS: Array<{ key: keyof PrivacySettings; label: string }> = [
    { key: 'showIncidentDetails', label: 'Incident details' },
    { key: 'showIncidentDescriptions', label: 'Incident descriptions' },
    { key: 'showIncidentTimestamps', label: 'Incident timestamps' },
    { key: 'showAffectedServices', label: 'Affected services' },
    { key: 'showIncidentUrgency', label: 'Incident urgency' },
    { key: 'showServiceMetrics', label: 'Service metrics' },
    { key: 'showServiceDescriptions', label: 'Service descriptions' },
    { key: 'showServiceRegions', label: 'Service regions' },
    { key: 'showUptimeHistory', label: 'Uptime history' },
    { key: 'showRecentIncidents', label: 'Recent incidents' },
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}>
      {/* Privacy Mode Presets */}
      <Card>
        <div style={{ padding: 'var(--spacing-6)' }}>
          <h2
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: '700',
              marginBottom: 'var(--spacing-4)',
            }}
          >
            Privacy Level
          </h2>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--text-muted)',
              marginBottom: 'var(--spacing-4)',
            }}
          >
            Choose a privacy preset or customize individual settings below.
          </p>
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
        </div>
      </Card>

      {/* Incident Privacy Settings */}
      <Card>
        <div style={{ padding: 'var(--spacing-6)' }}>
          <h2
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: '700',
              marginBottom: 'var(--spacing-4)',
            }}
          >
            Incident Information
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            <Switch
              checked={settings.showIncidentDetails}
              onChange={checked => updateSetting('showIncidentDetails', checked)}
              label="Show Incident Details"
              helperText="Show the full incident timeline and update details"
            />
            <Switch
              checked={settings.showIncidentTitles}
              onChange={checked => updateSetting('showIncidentTitles', checked)}
              label="Show Incident Titles"
              helperText="Display incident titles on the status page"
            />
            <Switch
              checked={settings.showIncidentDescriptions}
              onChange={checked => updateSetting('showIncidentDescriptions', checked)}
              label="Show Incident Descriptions"
              helperText="Display detailed incident descriptions"
            />
            <Switch
              checked={settings.showAffectedServices}
              onChange={checked => updateSetting('showAffectedServices', checked)}
              label="Show Affected Services"
              helperText="Display which services are affected by incidents"
            />
            <Switch
              checked={settings.showIncidentTimestamps}
              onChange={checked => updateSetting('showIncidentTimestamps', checked)}
              label="Show Incident Timestamps"
              helperText="Display when incidents occurred and were resolved"
            />
            <Switch
              checked={settings.showIncidentUrgency}
              onChange={checked => updateSetting('showIncidentUrgency', checked)}
              label="Show Incident Urgency"
              helperText="Display urgency level (High/Medium/Low) for incidents"
            />
            <Switch
              checked={settings.showIncidentAssignees}
              onChange={checked => updateSetting('showIncidentAssignees', checked)}
              label="Show Incident Assignees"
              helperText="Display who is assigned to handle incidents"
            />
          </div>
        </div>
      </Card>

      {/* Service Information */}
      <Card>
        <div style={{ padding: 'var(--spacing-6)' }}>
          <h2
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: '700',
              marginBottom: 'var(--spacing-4)',
            }}
          >
            Service Information
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
            <Switch
              checked={settings.showServiceMetrics}
              onChange={checked => updateSetting('showServiceMetrics', checked)}
              label="Show Service Metrics"
              helperText="Display uptime percentages and availability metrics"
            />
            <Switch
              checked={settings.showServiceDescriptions}
              onChange={checked => updateSetting('showServiceDescriptions', checked)}
              label="Show Service Descriptions"
              helperText="Display service descriptions and details"
            />
            <Switch
              checked={settings.showServiceRegions}
              onChange={checked => updateSetting('showServiceRegions', checked)}
              label="Show Service Regions"
              helperText="Display hosting regions for each service"
            />
            <Switch
              checked={settings.showUptimeHistory}
              onChange={checked => updateSetting('showUptimeHistory', checked)}
              label="Show Uptime History"
              helperText="Display historical uptime charts and timelines"
            />
            <Switch
              checked={settings.showTeamInformation}
              onChange={checked => updateSetting('showTeamInformation', checked)}
              label="Show Team Information"
              helperText="Display team names and ownership information"
            />
          </div>
        </div>
      </Card>

      {/* Advanced Privacy Settings */}
      <Card>
        <div style={{ padding: 'var(--spacing-6)' }}>
          <h2
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: '700',
              marginBottom: 'var(--spacing-4)',
            }}
          >
            Advanced Privacy Settings
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
            <Switch
              checked={settings.showRecentIncidents}
              onChange={checked => updateSetting('showRecentIncidents', checked)}
              label="Show Recent Incidents"
              helperText="Display recent incidents list"
            />
            <FormField
              type="input"
              label="Maximum Incidents to Show"
              inputType="number"
              value={settings.maxIncidentsToShow.toString()}
              onChange={e => updateSetting('maxIncidentsToShow', parseInt(e.target.value) || 50)}
              helperText="Limit the number of incidents displayed (1-500)"
            />
            <FormField
              type="input"
              label="Incident History Days"
              inputType="number"
              value={settings.incidentHistoryDays.toString()}
              onChange={e => updateSetting('incidentHistoryDays', parseInt(e.target.value) || 90)}
              helperText="How many days of incident history to display"
            />
            <FormField
              type="input"
              label="Data Retention Days (Optional)"
              inputType="number"
              value={settings.dataRetentionDays?.toString() || ''}
              onChange={e =>
                updateSetting('dataRetentionDays', e.target.value ? parseInt(e.target.value) : null)
              }
              helperText="Auto-hide incidents older than this many days. Leave empty for no limit."
            />
            {customFields.length > 0 && (
              <div>
                <Switch
                  checked={settings.showCustomFields}
                  onChange={checked => updateSetting('showCustomFields', checked)}
                  label="Show Custom Fields"
                  helperText="Display custom fields on incidents"
                />
                {settings.showCustomFields && (
                  <div
                    style={{
                      marginTop: 'var(--spacing-3)',
                      padding: 'var(--spacing-3)',
                      background: '#f9fafb',
                      borderRadius: 'var(--radius-md)',
                    }}
                  >
                    <p
                      style={{
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--text-muted)',
                        marginBottom: 'var(--spacing-2)',
                      }}
                    >
                      Available custom fields:
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                      {customFields.map(field => (
                        <span
                          key={field.id}
                          style={{
                            padding: 'var(--spacing-1) var(--spacing-2)',
                            background: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 'var(--font-size-xs)',
                          }}
                        >
                          {field.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Privacy Summary */}
      <Card>
        <div style={{ padding: 'var(--spacing-6)' }}>
          <h2
            style={{
              fontSize: 'var(--font-size-xl)',
              fontWeight: '700',
              marginBottom: 'var(--spacing-4)',
            }}
          >
            Privacy Summary
          </h2>
          <div
            style={{
              padding: 'var(--spacing-4)',
              background: '#f9fafb',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <div
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--text-muted)',
                marginBottom: 'var(--spacing-2)',
              }}
            >
              Current privacy mode: <strong>{settings.privacyMode}</strong>
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
              These settings control what information is visible on your public status page. Changes
              take effect immediately after saving.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
