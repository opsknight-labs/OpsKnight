'use client';
/* eslint-disable @next/next/no-img-element */

import { Button, FormField, Switch } from '@/components/ui';
import StatusPageDesignSection from '@/components/status-page/StatusPageDesignSection';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { Type, Layout, Image as ImageIcon } from 'lucide-react';
import { STATUS_PAGE_FONTS } from '@/lib/status-page-theme';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function AppearanceSection({ ctx }: { ctx: StatusPageConfigState }) {
  const { setFormData, formData, handleLogoUpload, logoUploadError } = ctx;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-6)',
      }}
    >
      <StatusPageDesignSection
        part="theme"
        themeId={formData.themeId}
        density={formData.themeDensity}
        customCss={formData.customCss}
        colorScheme={formData.colorScheme}
        onThemeChange={themeId => setFormData(prev => ({ ...prev, themeId }))}
        onDensityChange={themeDensity => setFormData(prev => ({ ...prev, themeDensity }))}
        onColorSchemeChange={colorScheme => setFormData(prev => ({ ...prev, colorScheme }))}
        onCustomCssChange={customCss => setFormData(prev => ({ ...prev, customCss }))}
      />
      <StatusPageSectionCard
        title="Branding & Logo"
        description="Upload your company logo and set the browser favicon for your status page."
        icon={<ImageIcon className="w-5 h-5 text-primary" />}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setFormData({ ...formData, logoUrl: '/logo.svg' })}
          >
            Use default app logo
          </Button>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <FormField
              type="input"
              inputType="text"
              label="Logo URL"
              value={formData.logoUrl}
              onChange={e => setFormData({ ...formData, logoUrl: e.target.value })}
              placeholder="https://yourcompany.com/logo.png"
              helperText="Full URL or relative path (e.g., /logo.svg). Recommended: 200x50px."
              required={false}
            />
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Upload Logo File
              </label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={e => handleLogoUpload(e.target.files?.[0] || null)}
                className="w-full text-xs text-muted-foreground file:mr-3 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
              />
              <div className="text-2xs text-muted-foreground mt-1">
                Uploads stored as data URLs. Max size 2MB.
              </div>
              {logoUploadError && (
                <div className="text-2xs text-destructive mt-1 font-medium">{logoUploadError}</div>
              )}
            </div>
            {formData.logoUrl && (
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <div className="text-xs font-semibold text-foreground mb-2">Logo Preview:</div>
                <div className="p-2.5 bg-background border border-border/80 rounded-md inline-block">
                  <img
                    src={formData.logoUrl}
                    alt="Logo preview"
                    className="h-10 max-w-[180px] object-contain"
                    onError={e => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      const parent = (e.target as HTMLImageElement).parentElement;
                      if (parent) {
                        parent.innerHTML =
                          '<div class="p-2 text-destructive text-xs">Failed to load image.</div>';
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <FormField
              type="input"
              inputType="url"
              label="Favicon URL"
              value={formData.faviconUrl}
              onChange={e => setFormData({ ...formData, faviconUrl: e.target.value })}
              placeholder="https://yourcompany.com/favicon.ico"
              helperText="Recommended: 16x16 or 32x32px, ICO or PNG format."
            />
            {formData.faviconUrl && (
              <div className="p-3 rounded-lg bg-muted/40 border border-border">
                <div className="text-xs font-semibold text-foreground mb-2">Favicon Preview:</div>
                <div className="p-2 bg-background border border-border/80 rounded-md inline-block">
                  <img
                    src={formData.faviconUrl}
                    alt="Favicon preview"
                    className="w-8 h-8 object-contain"
                    onError={e => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      const parent = (e.target as HTMLImageElement).parentElement;
                      if (parent) {
                        parent.innerHTML =
                          '<div class="p-2 text-destructive text-xs">Failed to load favicon.</div>';
                      }
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Typography & Font Family"
        description="Choose typography that matches your brand identity across all status page elements."
        icon={<Type className="w-5 h-5 text-primary" />}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-4)',
          }}
        >
          <FormField
            type="select"
            label="Primary Font Family"
            value={formData.fontFamily || 'default'}
            onChange={e => setFormData({ ...formData, fontFamily: e.target.value })}
            options={STATUS_PAGE_FONTS.map(f => ({
              value: f.id,
              label: `${f.name} (${f.category})`,
            }))}
            helperText="Applies clean typography to the header, incident reports, service metrics, and subscriber forms."
          />
          <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-4">
            <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Live Font Preview
            </div>
            <div
              style={{
                fontFamily:
                  STATUS_PAGE_FONTS.find(f => f.id === (formData.fontFamily || 'default'))
                    ?.fontFamily || 'inherit',
              }}
              className="text-lg font-bold text-foreground"
            >
              All Systems Operational — 99.98% 30-Day Uptime
            </div>
            <div
              style={{
                fontFamily:
                  STATUS_PAGE_FONTS.find(f => f.id === (formData.fontFamily || 'default'))
                    ?.fontFamily || 'inherit',
              }}
              className="text-sm text-muted-foreground"
            >
              Incident communication, automated health telemetry, and service status tracking.
            </div>
          </div>
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Layout Options"
        description="Configure maximum page width and header/footer visibility."
        icon={<Layout className="w-5 h-5 text-primary" />}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-3)',
          }}
        >
          <FormField
            type="select"
            label="Content Width"
            value={formData.layout}
            onChange={e => setFormData({ ...formData, layout: e.target.value })}
            options={[
              { value: 'compact', label: 'Compact (~900px)' },
              { value: 'default', label: 'Standard (~1280px)' },
              { value: 'wide', label: 'Wide (~1600px)' },
            ]}
            helperText="Controls maximum page width on large displays."
          />
          <Switch
            checked={formData.showHeader}
            onChange={checked => setFormData({ ...formData, showHeader: checked })}
            label="Show Header"
            helperText={
              formData.showHeader
                ? 'Display the top navigation bar with logo and page title.'
                : 'When hidden, subscribe and API links remain accessible via the footer (if footer is enabled).'
            }
          />
          <Switch
            checked={formData.showFooter}
            onChange={checked => setFormData({ ...formData, showFooter: checked })}
            label="Show Footer"
            helperText="Display the footer with support links, API links, and copyright."
          />
        </div>
      </StatusPageSectionCard>
      <StatusPageDesignSection
        part="css"
        themeId={formData.themeId}
        density={formData.themeDensity}
        customCss={formData.customCss}
        colorScheme={formData.colorScheme}
        onThemeChange={themeId => setFormData(prev => ({ ...prev, themeId }))}
        onDensityChange={themeDensity => setFormData(prev => ({ ...prev, themeDensity }))}
        onColorSchemeChange={colorScheme => setFormData(prev => ({ ...prev, colorScheme }))}
        onCustomCssChange={customCss => setFormData(prev => ({ ...prev, customCss }))}
      />
    </div>
  );
}
