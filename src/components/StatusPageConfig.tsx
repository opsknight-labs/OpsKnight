'use client';

import { Button } from '@/components/ui';
import StatusPageLivePreview from '@/components/status-page/StatusPageLivePreview';
import { InlineNotice } from '@/components/ui/InlineNotice';
import StatusPageWebhooksSettings from '@/components/status-page/StatusPageWebhooksSettings';
import StatusPageSubscribers from '@/components/status-page/StatusPageSubscribers';
import StatusPageSubscriberChannels from '@/components/status-page/StatusPageSubscriberChannels';
import StatusPageEmailConfig from '@/components/status-page/StatusPageEmailConfig';
import StatusPageAnnouncementManager from '@/components/status-page/StatusPageAnnouncementManager';
import { Badge } from '@/components/ui/shadcn/badge';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import StatusPageSectionErrorBoundary from '@/components/status-page/StatusPageSectionErrorBoundary';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { cn } from '@/lib/utils';
import { Eye, EyeOff, Save, Trash2, Mail, Users } from 'lucide-react';
import AdvancedSection from '@/components/status-page/config/AdvancedSection';
import ContentSection from '@/components/status-page/config/ContentSection';
import PrivacySection from '@/components/status-page/config/PrivacySection';
import Services2Section from '@/components/status-page/config/Services2Section';
import ServicesSection from '@/components/status-page/config/ServicesSection';
import AppearanceSection from '@/components/status-page/config/AppearanceSection';
import GeneralSection from '@/components/status-page/config/GeneralSection';
import {
  useStatusPageConfigState,
  type StatusPageConfigProps,
} from '@/components/status-page/config/useStatusPageConfigState';

export default function StatusPageConfig(props: StatusPageConfigProps) {
  const ctx = useStatusPageConfigState(props);
  const {
    sidebarItems,
    activeSection,
    setActiveSection,
    setShowPreview,
    showPreview,
    statusPage,
    announcements,
    setAnnouncements,
    announcementServiceOptions,
    allBusinessServices,
    browserTimeZone,
    draftIncidentId,
    handleSubmit,
    publication,
    handleRetryPublication,
    retryingPublication,
    error,
    handleDeletePage,
    isPending,
    handleDiscardChanges,
    previewData,
    previewMaxWidth,
    previewDomain,
  } = ctx;
  return (
    <div className="status-page-config-root w-full">
      <div
        className="status-page-config"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 100px)',
          gap: 0,
          overflow: 'hidden',
        }}
      >
        {/* Top Navigation */}
        <div className="status-page-config-tabs">
          <div className="status-page-config-tabs-list">
            {sidebarItems.map(item => {
              const ItemComponent = item.link ? 'a' : 'button';
              const isActive = activeSection === item.id;
              return (
                <ItemComponent
                  key={item.id}
                  data-tab-id={item.id}
                  type={!item.link ? 'button' : undefined}
                  href={item.link}
                  onClick={() => !item.link && setActiveSection(item.id)}
                  className={cn(
                    'status-page-config-tab inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer select-none whitespace-nowrap border',
                    isActive
                      ? 'is-active bg-primary text-primary-foreground border-primary shadow-2xs font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/70 border-transparent'
                  )}
                >
                  {item.icon && (
                    <span className="status-page-config-tab-icon inline-flex items-center justify-center shrink-0">
                      {item.icon}
                    </span>
                  )}
                  <span>{item.label}</span>
                  {item.badge ? (
                    <Badge
                      variant={isActive ? 'default' : 'neutral'}
                      size="xs"
                      className={cn(
                        'ml-1 px-1.5 py-0 text-2xs font-bold rounded-full',
                        isActive
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {item.badge}
                    </Badge>
                  ) : null}
                </ItemComponent>
              );
            })}
          </div>
          <div className="status-page-config-tabs-actions shrink-0">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className={cn(
                'status-page-config-preview-toggle inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border cursor-pointer select-none',
                showPreview
                  ? 'bg-primary text-primary-foreground border-primary shadow-2xs hover:bg-primary/90'
                  : 'bg-background hover:bg-muted text-foreground border-border shadow-2xs'
              )}
              aria-pressed={showPreview}
              title={
                showPreview ? 'Hide live status page preview' : 'Show live status page preview'
              }
            >
              {showPreview ? (
                <EyeOff className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Eye className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              )}
              <span>{showPreview ? 'Hide Preview' : 'Show Preview'}</span>
            </button>
          </div>
        </div>

        {/* Content Area with Optional Preview */}
        <div
          className="status-page-config-body"
          style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
        >
          {/* Settings Content */}
          <div
            className="status-page-config-settings"
            style={{
              flex: showPreview ? '0 0 52%' : '1',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              background: 'hsl(var(--ui-muted))',
              transition: 'flex 0.3s ease',
            }}
          >
            {/* Scrollable Content */}
            <div
              className="status-page-config-settings-scroll"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'var(--spacing-4)',
              }}
            >
              <StatusPageSectionErrorBoundary key={activeSection} sectionName={activeSection}>
                {['announcements', 'integrations', 'subscribers', 'email-delivery'].includes(
                  activeSection
                ) ? (
                  <div
                    className="status-page-config-settings-inner"
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}
                  >
                    {/* Announcements */}
                    {activeSection === 'announcements' && (
                      <StatusPageAnnouncementManager
                        statusPageId={statusPage.id}
                        announcements={announcements ?? []}
                        setAnnouncements={setAnnouncements}
                        allServices={announcementServiceOptions ?? []}
                        businessServices={allBusinessServices.filter(business =>
                          (statusPage.businessServices ?? []).some(
                            mapping => mapping.businessServiceId === business.id
                          )
                        )}
                        browserTimeZone={browserTimeZone}
                        draftIncidentId={draftIncidentId}
                        updateCadenceMinutes={statusPage.updateCadenceMinutes ?? null}
                      />
                    )}

                    {/* Integrations */}
                    {activeSection === 'integrations' && (
                      <StatusPageWebhooksSettings statusPageId={statusPage.id} />
                    )}

                    {/* Subscribers */}
                    {activeSection === 'subscribers' && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--spacing-6)',
                        }}
                      >
                        <StatusPageSectionCard
                          title="Subscribers"
                          description="Manage your subscriber audience, search emails, view verification status, and perform bulk unsubscription."
                          icon={<Users className="w-5 h-5 text-primary" />}
                        >
                          <div className="space-y-6">
                            <StatusPageSubscriberChannels statusPageId={statusPage.id} />
                            <StatusPageSubscribers statusPageId={statusPage.id} />
                          </div>
                        </StatusPageSectionCard>
                      </div>
                    )}

                    {/* Email Delivery */}
                    {activeSection === 'email-delivery' && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'var(--spacing-6)',
                        }}
                      >
                        <StatusPageSectionCard
                          title="Email Delivery"
                          description="Configure which email provider to use for subscription verification and status page notification alerts."
                          icon={<Mail className="w-5 h-5 text-primary" />}
                        >
                          <StatusPageEmailConfig
                            statusPageId={statusPage.id}
                            currentProvider={statusPage.emailProvider}
                          />
                        </StatusPageSectionCard>
                      </div>
                    )}
                  </div>
                ) : (
                  <form
                    id="status-page-section-form"
                    onSubmit={handleSubmit}
                    style={{ display: 'contents' }}
                  >
                    <div
                      className="status-page-config-settings-inner"
                      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}
                    >
                      {/* General Settings */}
                      {activeSection === 'general' && <GeneralSection ctx={ctx} />}

                      {/* Appearance Settings */}
                      {activeSection === 'appearance' && <AppearanceSection ctx={ctx} />}

                      {/* Design Settings */}

                      {/* Services Configuration */}
                      {activeSection === 'services' && <ServicesSection ctx={ctx} />}
                      {activeSection === 'services' && <Services2Section ctx={ctx} />}

                      {/* Privacy Settings */}
                      {activeSection === 'privacy' && <PrivacySection ctx={ctx} />}

                      {/* Content Settings */}
                      {activeSection === 'content' && <ContentSection ctx={ctx} />}

                      {/* Advanced Settings */}
                      {activeSection === 'advanced' && <AdvancedSection ctx={ctx} />}

                      {/* Publication state is reported separately from save state: settings can
                    persist while publishing them to the public page fails. */}
                      {publication && publication.status !== 'LIVE' && (
                        <div
                          role={publication.status === 'FAILED' ? 'alert' : 'status'}
                          className={cn(
                            'mb-4 p-3 rounded-lg border flex items-start justify-between gap-3 flex-wrap text-sm',
                            publication.status === 'FAILED'
                              ? 'bg-amber-500/10 border-amber-500/25 text-amber-900 dark:text-amber-200'
                              : 'bg-primary/5 border-primary/20 text-foreground'
                          )}
                        >
                          <div>
                            <strong className="block mb-0.5">
                              {publication.status === 'FAILED'
                                ? '⚠ Publication failed'
                                : publication.status === 'PUBLISHING'
                                  ? '◐ Publishing'
                                  : '○ Disabled'}
                            </strong>
                            <span className="text-xs text-muted-foreground">
                              {publication.status === 'FAILED'
                                ? 'Your settings were saved but could not be published.' +
                                  (publication.stale
                                    ? ' Visitors are still seeing the last published version.'
                                    : ' The public page is unavailable until this succeeds.')
                                : publication.status === 'PUBLISHING'
                                  ? 'The public page is being rebuilt and will update shortly.'
                                  : 'This status page is turned off, so its public URL is unavailable.'}
                            </span>
                          </div>
                          {publication.status === 'FAILED' && (
                            <Button
                              variant="secondary"
                              onClick={handleRetryPublication}
                              disabled={retryingPublication}
                            >
                              {retryingPublication ? 'Retrying…' : 'Retry publication'}
                            </Button>
                          )}
                        </div>
                      )}

                      {error && (
                        <InlineNotice tone="error" className="mb-4">
                          {error}
                        </InlineNotice>
                      )}
                    </div>
                  </form>
                )}
              </StatusPageSectionErrorBoundary>
            </div>
            {/* Sections with independent controls persist through their own APIs. */}
            {!['announcements', 'integrations', 'subscribers', 'email-delivery'].includes(
              activeSection
            ) && (
              <div className="status-page-config-sticky-bar flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border bg-card shadow-md">
                <div className="flex items-center gap-3">
                  <DeleteConfirmDialog
                    title="Delete Status Page"
                    description={`Permanently removes this page and its page-specific subscriptions, announcements, tokens, mappings, and webhooks. Shared services and incidents are not deleted.${statusPage.isDefault ? ' If other pages exist, make one of them the default first.' : ''}`}
                    requireMatchText="delete"
                    confirmText="Delete status page"
                    onConfirm={handleDeletePage}
                    trigger={
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={isPending}
                        className="text-xs font-semibold gap-1.5 shadow-2xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete status page</span>
                      </Button>
                    }
                  />
                  <div className="text-xs text-muted-foreground hidden md:block">
                    Unsaved modifications apply to this status page configuration.
                  </div>
                </div>
                <div className="flex items-center gap-2.5 ml-auto">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleDiscardChanges}
                    disabled={isPending}
                    className="text-xs font-semibold shadow-2xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    form="status-page-section-form"
                    variant="primary"
                    size="sm"
                    isLoading={isPending}
                    className="text-xs font-semibold gap-1.5 shadow-xs"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save Settings</span>
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Preview Panel */}
          {showPreview && previewData && (
            <div
              className="status-page-config-preview"
              style={{
                flex: '0 0 48%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minWidth: 0,
                borderLeft: '1px solid hsl(var(--ui-border, 214.3 31.8% 91.4%))',
                background: 'hsl(var(--ui-card, 0 0% 100%))',
              }}
            >
              <StatusPageLivePreview
                previewData={previewData}
                maxWidth={previewMaxWidth}
                previewDomain={previewDomain}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
