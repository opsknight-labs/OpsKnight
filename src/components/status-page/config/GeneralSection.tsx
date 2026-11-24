'use client';

import { Button, FormField, Switch } from '@/components/ui';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { Globe, Shield, Link2, Mail } from 'lucide-react';
import StatusPageDomainCheck from '@/components/status-page/StatusPageDomainCheck';
import type { StatusPageConfigState } from './useStatusPageConfigState';

export default function GeneralSection({ ctx }: { ctx: StatusPageConfigState }) {
  const {
    statusPage,
    handleMakeDefault,
    formData,
    setFormData,
    privacySettings,
    setPrivacySettings,
  } = ctx;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-4)',
      }}
    >
      <StatusPageSectionCard
        title="Basic Settings"
        description="Define the identity and presentation name displayed on your public status page."
        icon={<Globe className="h-4 w-4" />}
        footer={
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 w-full">
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Default routing:</span>{' '}
              {statusPage.isDefault
                ? 'This page serves /status and the legacy /api/status endpoint. It does not provide settings to other pages.'
                : 'This page is independent. Make it the default only to route legacy /status requests here.'}
            </div>
            {!statusPage.isDefault && (
              <Button type="button" variant="secondary" size="sm" onClick={handleMakeDefault}>
                Make default
              </Button>
            )}
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            type="input"
            label="Status Page Name"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            required
            helperText="The name displayed at the top of your status page"
          />

          <FormField
            type="input"
            label="Organization Name"
            value={formData.organizationName}
            onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
            helperText="Used in subscriber emails, email branding, and footer copyright."
            placeholder="e.g. OpsKnight"
          />
        </div>

        <FormField
          type="input"
          label="Public URL Slug"
          value={formData.slug}
          onChange={e =>
            setFormData({
              ...formData,
              slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
            })
          }
          placeholder="public-status"
          helperText="Optional for the default page; required for a dedicated /status/your-slug URL."
        />
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Access & Visibility"
        description="Control who can access the status page and when it is publicly visible."
        icon={<Shield className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
            <Switch
              checked={formData.enabled}
              onChange={checked => setFormData(prev => ({ ...prev, enabled: checked }))}
              label="Enable Status Page"
              helperText="Make the status page accessible to users."
            />
          </div>

          {formData.enabled ? (
            <div className="p-3.5 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
              <Switch
                checked={!privacySettings.requireAuth}
                onChange={checked =>
                  setPrivacySettings(prev => ({
                    ...prev,
                    requireAuth: !checked,
                  }))
                }
                label="Public Access"
                helperText="Anyone can view without logging in."
              />
            </div>
          ) : null}
        </div>
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Domain Configuration"
        description="Configure subdomains and custom domains to host your status page."
        icon={<Link2 className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            type="input"
            label="Subdomain"
            value={formData.subdomain}
            onChange={e => setFormData({ ...formData, subdomain: e.target.value })}
            placeholder="status"
            helperText="e.g., status (for status.yourcompany.com)."
          />

          <FormField
            type="input"
            label="Custom Domain"
            value={formData.customDomain}
            onChange={e => setFormData({ ...formData, customDomain: e.target.value })}
            placeholder="status.yourcompany.com"
            helperText="Full custom domain pointing to your status page."
          />
        </div>
        <StatusPageDomainCheck
          pageId={statusPage.id}
          savedDomain={statusPage.customDomain ?? null}
          unsaved={(formData.customDomain || '') !== (statusPage.customDomain || '')}
        />
      </StatusPageSectionCard>

      <StatusPageSectionCard
        title="Contact Information"
        description="Public contact email and support portal URL for visitor inquiries."
        icon={<Mail className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            type="input"
            inputType="email"
            label="Contact Email"
            value={formData.contactEmail}
            onChange={e => setFormData({ ...formData, contactEmail: e.target.value })}
            placeholder="support@yourcompany.com"
            helperText="Email address for users to contact you"
          />

          <FormField
            type="input"
            inputType="url"
            label="Contact URL"
            value={formData.contactUrl}
            onChange={e => setFormData({ ...formData, contactUrl: e.target.value })}
            placeholder="https://yourcompany.com/contact"
            helperText="URL for contact page or support portal"
          />
        </div>
      </StatusPageSectionCard>
    </div>
  );
}
