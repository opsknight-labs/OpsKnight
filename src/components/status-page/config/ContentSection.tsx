'use client';

import { FormField, Switch } from '@/components/ui';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { Globe, Sliders, FileText } from 'lucide-react';
import type React from 'react';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function ContentSection({ ctx }: { ctx: StatusPageConfigState }) {
  const { formData, setFormData, setPrivacySettings, privacySettings, statusPage } = ctx;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-6)',
      }}
    >
      <StatusPageSectionCard
        title="Display Options"
        description="Toggle which sections and metrics are shown to visitors on your status page."
        icon={<Sliders className="w-5 h-5 text-primary" />}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showServices}
                onChange={checked => setFormData({ ...formData, showServices: checked })}
                label="Show Services"
                helperText="Display service status list (disabling hides all service cards from the page)"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showIncidents}
                onChange={checked => {
                  setFormData(prev => ({ ...prev, showIncidents: checked }));
                  setPrivacySettings(prev => ({
                    ...prev,
                    showRecentIncidents: checked,
                  }));
                }}
                label="Show Incidents"
                helperText="Display incidents section and timeline"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showMetrics && privacySettings.showServiceMetrics !== false}
                onChange={checked => {
                  setFormData(prev => ({ ...prev, showMetrics: checked }));
                  setPrivacySettings(prev => ({
                    ...prev,
                    showServiceMetrics: checked,
                  }));
                }}
                label="Show Service Metrics"
                helperText="Display uptime percentages and availability metrics"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={privacySettings.showUptimeHistory !== false}
                onChange={checked => {
                  setPrivacySettings(prev => ({
                    ...prev,
                    showUptimeHistory: checked,
                  }));
                }}
                label="Show Uptime History"
                helperText="Display historical uptime charts and timelines"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showSlaMetrics !== false}
                onChange={checked => {
                  setFormData(prev => ({ ...prev, showSlaMetrics: checked }));
                }}
                label="Show 30 & 90-Day SLA"
                helperText="Display 30-day and 90-day SLA availability cards below service history"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showServiceMeta === true}
                onChange={checked => {
                  setFormData(prev => ({ ...prev, showServiceMeta: checked }));
                }}
                label="Show service tier and owner"
                helperText="Display each service's tier and owning team chips. Off by default."
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showSubscribe}
                onChange={checked => setFormData({ ...formData, showSubscribe: checked })}
                label="Show Subscribe to Updates"
                helperText="Display email subscription section"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showChangelog}
                onChange={checked => setFormData({ ...formData, showChangelog: checked })}
                label="Show Changelog"
                helperText="Display recent update announcements"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={formData.showRegionHeatmap}
                onChange={checked => {
                  setFormData({ ...formData, showRegionHeatmap: checked });
                  if (checked && privacySettings.showServiceRegions === false) {
                    setPrivacySettings(prev => ({
                      ...prev,
                      showServiceRegions: true,
                    }));
                  }
                }}
                label="Show Region Heatmap"
                helperText="Display a compact region impact grid"
              />
            </div>
            <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors md:col-span-2">
              <Switch
                checked={formData.showPostIncidentReview}
                onChange={checked => setFormData({ ...formData, showPostIncidentReview: checked })}
                label="Show Post-Incident Reviews"
                helperText="Show links to published postmortems on resolved incidents"
              />
            </div>
          </div>

          {formData.showMetrics && (
            <div
              style={{
                marginTop: 'var(--spacing-4)',
                padding: 'var(--spacing-4)',
                background: 'hsl(var(--ui-muted))',
                borderRadius: 'var(--radius-md)',
                border: '1px solid hsl(var(--ui-border))',
              }}
            >
              <h4
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: '600',
                  marginBottom: 'var(--spacing-3)',
                  color: 'hsl(var(--ui-foreground))',
                }}
              >
                Uptime Thresholds
              </h4>
              <p
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'hsl(var(--ui-muted-foreground))',
                  marginBottom: 'var(--spacing-3)',
                }}
              >
                Configure SLA thresholds for color-coding uptime metrics
              </p>
              <div
                style={{
                  display: 'grid',
                  gap: 'var(--spacing-3)',
                  gridTemplateColumns: '1fr 1fr',
                }}
              >
                <FormField
                  type="input"
                  label="Excellent Threshold (%)"
                  value={String(formData.uptimeExcellentThreshold)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 100) {
                      setFormData({
                        ...formData,
                        uptimeExcellentThreshold: val,
                      });
                    }
                  }}
                  helperText="Green: uptime ≥ this value (default: 99.9%)"
                />
                <FormField
                  type="input"
                  label="Good Threshold (%)"
                  value={String(formData.uptimeGoodThreshold)}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0 && val <= 100) {
                      setFormData({ ...formData, uptimeGoodThreshold: val });
                    }
                  }}
                  helperText="Yellow: uptime ≥ this value (default: 99.0%)"
                />
              </div>
              {formData.uptimeGoodThreshold > formData.uptimeExcellentThreshold && (
                <div className="mt-3 px-3 py-2 rounded-md text-xs font-medium bg-destructive/10 border border-destructive/25 text-destructive">
                  ⚠️ Good threshold must be less than or equal to Excellent threshold
                </div>
              )}
            </div>
          )}
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Footer"
        description="Set custom footer text and copyright notices for your status page."
        icon={<FileText className="w-5 h-5 text-primary" />}
      >
        <FormField
          type="textarea"
          label="Footer Text"
          rows={3}
          value={formData.footerText}
          onChange={e => setFormData({ ...formData, footerText: e.target.value })}
          placeholder="(c) 2024 Your Company. All rights reserved."
          helperText="Text to display at the bottom of the status page"
        />
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="SEO Settings"
        description="Search engine metadata and previews for public sharing."
        icon={<Globe className="w-5 h-5 text-primary" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            type="input"
            label="Meta Title"
            value={formData.metaTitle}
            onChange={e => setFormData({ ...formData, metaTitle: e.target.value })}
            placeholder={statusPage.name}
            helperText="Recommended: 50-60 characters"
          />
          <FormField
            type="textarea"
            label="Meta Description"
            rows={2}
            value={formData.metaDescription}
            onChange={e => setFormData({ ...formData, metaDescription: e.target.value })}
            placeholder={`Status page for ${statusPage.name}`}
            helperText="Recommended: 150-160 characters"
          />
        </div>
      </StatusPageSectionCard>
    </div>
  );
}
