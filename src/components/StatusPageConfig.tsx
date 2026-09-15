'use client';
/* eslint-disable @typescript-eslint/no-explicit-any, security/detect-object-injection, @next/next/no-img-element */

import { useState, useTransition, useMemo } from 'react';
import { statusPageSectionPatch } from '@/lib/status-pages/settings-sections';
import { Button, FormField, Switch } from '@/components/ui';
import StatusPageLivePreview from '@/components/status-page/StatusPageLivePreview';
import StatusPageDesignSection from '@/components/status-page/StatusPageDesignSection';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { notify } from '@/lib/toast';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import StatusPagePrivacySettings, {
  type PrivacySettings,
} from '@/components/status-page/StatusPagePrivacySettings';
import StatusPageWebhooksSettings from '@/components/status-page/StatusPageWebhooksSettings';
import StatusPageSubscribers from '@/components/status-page/StatusPageSubscribers';
import StatusPageEmailConfig from '@/components/status-page/StatusPageEmailConfig';
import StatusPageServicesManager from '@/components/status-page/StatusPageServicesManager';
import StatusPageAnnouncementManager from '@/components/status-page/StatusPageAnnouncementManager';
import { Badge } from '@/components/ui/shadcn/badge';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import StatusPageSectionErrorBoundary from '@/components/status-page/StatusPageSectionErrorBoundary';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { cn } from '@/lib/utils';
import {
  Settings,
  Wrench,
  Eye,
  EyeOff,
  Save,
  Trash2,
  Globe,
  Shield,
  Link2,
  Mail,
  Palette,
  Sparkles,
  Type,
  Layout,
  Image as ImageIcon,
  Sliders,
  Megaphone,
  Users,
  RefreshCw,
  RotateCcw,
  Rss,
  Key,
  FileText,
} from 'lucide-react';
import {
  STATUS_PAGE_FONTS,
  STATUS_PAGE_COLOR_PRESETS,
  computeStatusPageTheme,
} from '@/lib/status-page-theme';
import {
  STATUS_PAGE_THEME_VERSION,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
  type StatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';

type StatusPageBranding = {
  logoUrl?: string;
  logo?: string;
  faviconUrl?: string;
  primaryColor?: string;
  primary?: string;
  backgroundColor?: string;
  background?: string;
  textColor?: string;
  text?: string;
  fontFamily?: string;
  customCss?: string;
  layout?: string;
  showHeader?: boolean;
  showFooter?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  showRssLink?: boolean;
  showApiLink?: boolean;
  themeId?: string;
  themeVersion?: number;
  themeDensity?: StatusPageThemeDensity;
};

function isStatusPageBranding(value: unknown): value is StatusPageBranding {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type StatusPageConfigProps = {
  statusPage: {
    id: string;
    name: string;
    slug?: string | null;
    isDefault?: boolean;
    organizationName?: string | null;
    subdomain?: string | null;
    customDomain?: string | null;
    enabled: boolean;
    showServices: boolean;
    showIncidents: boolean;
    showMetrics: boolean;
    showSubscribe?: boolean;
    showServicesByRegion?: boolean;
    showServiceOwners?: boolean;
    showServiceSlaTier?: boolean;
    showChangelog?: boolean;
    showRegionHeatmap?: boolean;
    showPostIncidentReview?: boolean;
    enableUptimeExports?: boolean;
    statusApiRequireToken?: boolean;
    statusApiRateLimitEnabled?: boolean;
    statusApiRateLimitMax?: number;
    statusApiRateLimitWindowSec?: number;
    footerText?: string | null;
    contactEmail?: string | null;
    contactUrl?: string | null;
    emailProvider?: string | null;
    branding?: unknown;
    requireAuth?: boolean;
    updatedAt?: Date | string;
    privacyMode?: string | null;
    showIncidentDetails?: boolean;
    showIncidentTitles?: boolean;
    showIncidentDescriptions?: boolean;
    showAffectedServices?: boolean;
    showIncidentTimestamps?: boolean;
    showServiceMetrics?: boolean;
    showServiceDescriptions?: boolean;
    showServiceRegions?: boolean;
    showTeamInformation?: boolean;
    showCustomFields?: boolean;
    showIncidentAssignees?: boolean;
    showIncidentUrgency?: boolean;
    showUptimeHistory?: boolean;
    showRecentIncidents?: boolean;
    showIncidentHistoryDetails?: boolean;
    incidentHistoryDetailDays?: number | null;
    maxIncidentsToShow?: number;
    incidentHistoryDays?: number;
    allowedCustomFields?: string[];
    dataRetentionDays?: number | null;
    authProvider?: string | null;
    uptimeExcellentThreshold?: number;
    uptimeGoodThreshold?: number;
    services: Array<{
      id: string;
      serviceId: string;
      displayName?: string | null;
      showOnPage: boolean;
      order: number;
      service: {
        id: string;
        name: string;
        region?: string | null;
      };
    }>;
    announcements: Array<{
      id: string;
      title: string;
      message: string;
      type: string;
      startDate: string;
      endDate?: string | null;
      isActive: boolean;
      affectedServiceIds?: string[] | null;
    }>;
    apiTokens: Array<{
      id: string;
      name: string;
      prefix: string;
      createdAt: string;
      lastUsedAt?: string | null;
      revokedAt?: string | null;
    }>;
  };
  allServices: Array<{
    id: string;
    name: string;
    region?: string | null;
  }>;
  liveSnapshot?: any;
};

const ANNOUNCEMENT_TYPES = [
  { value: 'INCIDENT', label: 'Incident', color: '#ef4444', background: '#fee2e2' },
  { value: 'MAINTENANCE', label: 'Maintenance', color: '#2563eb', background: '#dbeafe' },
  { value: 'UPDATE', label: 'Update', color: '#10b981', background: '#dcfce7' },
  { value: 'WARNING', label: 'Warning', color: '#f59e0b', background: '#fef3c7' },
  { value: 'INFO', label: 'Information', color: '#64748b', background: '#f1f5f9' },
];

export default function StatusPageConfig({
  statusPage,
  allServices,
  liveSnapshot,
}: StatusPageConfigProps) {
  const { browserTimeZone } = useTimezone();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What the public page is actually doing, as reported by the save. Distinct from "saved",
  // because settings can persist while publishing them fails.
  const [publication, setPublication] = useState<{
    status: 'LIVE' | 'PUBLISHING' | 'FAILED' | 'DISABLED';
    revision: string;
    lastError?: string | null;
    stale?: boolean;
  } | null>(null);
  const [retryingPublication, setRetryingPublication] = useState(false);
  const [activeSection, setActiveSection] = useState('general');
  const [showPreview, setShowPreview] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(() =>
    statusPage.updatedAt ? new Date(statusPage.updatedAt).toISOString() : undefined
  );

  // Parse branding JSON
  const branding = isStatusPageBranding(statusPage.branding) ? statusPage.branding : {};

  const getInitialFormData = () => ({
    name: statusPage.name,
    slug: statusPage.slug || '',
    isDefault: statusPage.isDefault ?? false,
    organizationName: statusPage.organizationName || '',
    subdomain: statusPage.subdomain || '',
    customDomain: statusPage.customDomain || '',
    enabled: statusPage.enabled,
    showServices: statusPage.showServices,
    showIncidents: statusPage.showIncidents,
    showMetrics: statusPage.showMetrics,
    showSubscribe: statusPage.showSubscribe !== false,
    showServicesByRegion: statusPage.showServicesByRegion ?? false,
    uptimeExcellentThreshold: statusPage.uptimeExcellentThreshold ?? 99.9,
    uptimeGoodThreshold: statusPage.uptimeGoodThreshold ?? 99.0,
    footerText: statusPage.footerText || '',
    contactEmail: statusPage.contactEmail || '',
    contactUrl: statusPage.contactUrl || '',
    // Branding
    logoUrl: branding.logoUrl || branding.logo || '/logo.svg',
    faviconUrl: branding.faviconUrl || '',
    primaryColor: branding.primaryColor || branding.primary || '#667eea',
    backgroundColor: branding.backgroundColor || branding.background || '#ffffff',
    textColor: branding.textColor || branding.text || '#111827',
    fontFamily: branding.fontFamily || 'default',
    // Custom CSS
    customCss: branding.customCss || '',
    // Curated theme
    themeId: resolveStatusPageTheme(branding.themeId).id,
    themeVersion: STATUS_PAGE_THEME_VERSION,
    themeDensity: resolveStatusPageThemeDensity(branding.themeDensity),
    // Layout
    layout: branding.layout || 'default', // default, compact, wide
    showHeader: branding.showHeader !== false,
    showFooter: branding.showFooter !== false,
    // SEO
    metaTitle: branding.metaTitle || statusPage.name,
    metaDescription: branding.metaDescription || `Status page for ${statusPage.name}`,
    // Advanced
    autoRefresh: branding.autoRefresh !== false,
    refreshInterval: branding.refreshInterval || 60,
    showRssLink: branding.showRssLink !== false,
    showApiLink: branding.showApiLink !== false,
    showServiceOwners: statusPage.showServiceOwners ?? false,
    showServiceSlaTier: statusPage.showServiceSlaTier ?? false,
    showChangelog: statusPage.showChangelog ?? true,
    showRegionHeatmap: statusPage.showRegionHeatmap ?? true,
    showPostIncidentReview: statusPage.showPostIncidentReview ?? true,
    enableUptimeExports: statusPage.enableUptimeExports ?? false,
    statusApiRequireToken: statusPage.statusApiRequireToken ?? false,
    statusApiRateLimitEnabled: statusPage.statusApiRateLimitEnabled ?? false,
    statusApiRateLimitMax: statusPage.statusApiRateLimitMax ?? 120,
    statusApiRateLimitWindowSec: statusPage.statusApiRateLimitWindowSec ?? 60,
  });

  const [formData, setFormData] = useState(getInitialFormData);
  const [announcements, setAnnouncements] = useState(() => statusPage.announcements ?? []);
  const [apiTokens, setApiTokens] = useState(statusPage.apiTokens ?? []);
  const [apiTokenName, setApiTokenName] = useState('');
  const [apiTokenValue, setApiTokenValue] = useState<string | null>(null);
  const [apiTokenError, setApiTokenError] = useState<string | null>(null);
  const [apiTokenPending, startApiTokenTransition] = useTransition();

  type SidebarItem = {
    id: string;
    label: string;
    icon?: React.ReactNode;
    badge?: number;
    link?: string;
  };

  // Sidebar items - defined after announcements state
  const sidebarItems: SidebarItem[] = [
    { id: 'general', label: 'General', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'design', label: 'Design', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'services', label: 'Services', icon: <Wrench className="w-3.5 h-3.5" /> },
    { id: 'privacy', label: 'Privacy & Data', icon: <Shield className="w-3.5 h-3.5" /> },
    { id: 'content', label: 'Content', icon: <FileText className="w-3.5 h-3.5" /> },
    {
      id: 'announcements',
      label: 'Announcements',
      icon: <Megaphone className="w-3.5 h-3.5" />,
      badge: announcements.length,
    },
    { id: 'integrations', label: 'Integrations', icon: <Link2 className="w-3.5 h-3.5" /> },
    { id: 'subscribers', label: 'Subscribers', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'email-delivery', label: 'Email Delivery', icon: <Mail className="w-3.5 h-3.5" /> },
    { id: 'advanced', label: 'Advanced', icon: <Sliders className="w-3.5 h-3.5" /> },
  ];

  const getInitialSelectedServices = () => new Set(statusPage.services.map(s => s.serviceId));

  const getInitialServiceConfigs = () =>
    statusPage.services.reduce(
      (acc, sp) => {
        acc[sp.serviceId] = {
          displayName: sp.displayName || '',
          order: sp.order,
          showOnPage: sp.showOnPage,
        };
        return acc;
      },
      {} as Record<string, { displayName: string; order: number; showOnPage: boolean }>
    );

  const [selectedServices, setSelectedServices] = useState<Set<string>>(getInitialSelectedServices);

  const [serviceConfigs, setServiceConfigs] =
    useState<Record<string, { displayName: string; order: number; showOnPage: boolean }>>(
      getInitialServiceConfigs
    );

  const serviceLookup = new Map(allServices.map(service => [service.id, service] as const));

  const normalizeAnnouncementServiceIds = (value?: string[] | null) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map(id => id.trim()).filter(Boolean);
  };

  const buildAnnouncementAffectedServices = (value?: string[] | null) => {
    const ids = normalizeAnnouncementServiceIds(value);
    return ids
      .map(id => serviceLookup.get(id))
      .filter(Boolean)
      .map(service => ({
        id: service!.id,
        name: service!.name,
        region: service!.region ?? null,
      }));
  };

  const getAnnouncementRegions = (services: Array<{ region?: string | null }>) => {
    const regionSet = new Set<string>();
    services.forEach(service => {
      if (!service.region) return;
      service.region
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
        .forEach(region => regionSet.add(region));
    });
    return Array.from(regionSet.values());
  };

  // Privacy settings - with defaults if not in statusPage
  const getInitialPrivacySettings = (): PrivacySettings => ({
    privacyMode: (statusPage.privacyMode as PrivacySettings['privacyMode']) || 'PUBLIC',
    showIncidentDetails: statusPage.showIncidentDetails !== false,
    showIncidentTitles: statusPage.showIncidentTitles !== false,
    showIncidentDescriptions: statusPage.showIncidentDescriptions !== false,
    showAffectedServices: statusPage.showAffectedServices !== false,
    showIncidentTimestamps: statusPage.showIncidentTimestamps !== false,
    showServiceMetrics: statusPage.showServiceMetrics !== false,
    showServiceDescriptions: statusPage.showServiceDescriptions !== false,
    showServiceRegions: statusPage.showServiceRegions !== false,
    showTeamInformation: statusPage.showTeamInformation || false,
    showCustomFields: statusPage.showCustomFields || false,
    showIncidentAssignees: statusPage.showIncidentAssignees || false,
    showIncidentUrgency: statusPage.showIncidentUrgency !== false,
    showUptimeHistory: statusPage.showUptimeHistory !== false,
    showRecentIncidents: statusPage.showRecentIncidents !== false,
    showIncidentHistoryDetails: statusPage.showIncidentHistoryDetails ?? true,
    incidentHistoryDetailDays: statusPage.incidentHistoryDetailDays ?? 7,
    maxIncidentsToShow: statusPage.maxIncidentsToShow || 50,
    incidentHistoryDays: statusPage.incidentHistoryDays || 90,
    allowedCustomFields: statusPage.allowedCustomFields || [],
    dataRetentionDays: statusPage.dataRetentionDays || null,
    requireAuth: statusPage.requireAuth || false,
    authProvider: statusPage.authProvider || null,
  });

  const [privacySettings, setPrivacySettings] =
    useState<PrivacySettings>(getInitialPrivacySettings);

  const handleDiscardChanges = () => {
    setFormData(getInitialFormData());
    setPrivacySettings(getInitialPrivacySettings());
    setSelectedServices(getInitialSelectedServices());
    setServiceConfigs(getInitialServiceConfigs());
    setError(null);
    router.refresh();
  };

  const selectedServiceIds = Array.from(selectedServices);
  const announcementServiceOptions = allServices.filter(service =>
    selectedServices.has(service.id)
  );
  const hasSelectedRegions = allServices.some(
    service =>
      selectedServices.has(service.id) &&
      Boolean(service.region && service.region.trim().length > 0)
  );
  const previewServiceIds = selectedServiceIds;
  const previewServices = allServices
    .filter(service => previewServiceIds.includes(service.id))
    .map(service => {
      const liveService = liveSnapshot?.services?.find((s: any) => s.id === service.id);
      return {
        id: service.id,
        name: service.name,
        region: service.region ?? liveService?.regions?.[0] ?? null,
        description: (service as any).description ?? liveService?.description ?? null,
        slaTier: (service as any).slaTier ?? liveService?.slaTier ?? liveService?.sla?.tier ?? null,
        team: (service as any).team ?? liveService?.team ?? null,
        status: liveService?.status ?? 'OPERATIONAL',
        _count: { incidents: liveService?.activeIncidentCount ?? 0 },
        activeIncidentCount: liveService?.activeIncidentCount ?? 0,
        uptime: liveService?.uptime,
        history: liveService?.history,
      };
    });

  const previewStatusPageServices =
    selectedServiceIds.length > 0
      ? selectedServiceIds
          .map((serviceId, index) => {
            const config = serviceConfigs[serviceId] || {
              displayName: '',
              order: index,
              showOnPage: true,
            };
            return {
              id: `preview-${serviceId}`,
              serviceId,
              displayName: config.displayName || null,
              showOnPage: config.showOnPage !== false,
              order: config.order ?? index,
            };
          })
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      : [];

  const previewUptime90 = previewServices.reduce<Record<string, number>>((acc, service) => {
    const liveService = liveSnapshot?.services?.find((s: any) => s.id === service.id);
    acc[service.id] =
      typeof liveService?.uptime?.days90?.percentage === 'number'
        ? liveService.uptime.days90.percentage
        : 100;
    return acc;
  }, {});

  const today = new Date();
  const previewAnnouncements = announcements
    .map(announcement => ({
      ...announcement,
      startDate: new Date(announcement.startDate),
      endDate: announcement.endDate ? new Date(announcement.endDate) : null,
      affectedServiceIds: normalizeAnnouncementServiceIds(announcement.affectedServiceIds),
    }))
    .filter(announcement => {
      if (!announcement.isActive) {
        return false;
      }
      if (!announcement.endDate) {
        return true;
      }
      return announcement.endDate >= today;
    });

  const previewBranding = {
    logoUrl: formData.logoUrl,
    faviconUrl: formData.faviconUrl,
    primaryColor: formData.primaryColor,
    backgroundColor: formData.backgroundColor,
    textColor: formData.textColor,
    fontFamily: formData.fontFamily,
    customCss: formData.customCss,
    layout: formData.layout,
    showHeader: formData.showHeader,
    showFooter: formData.showFooter,
    showRssLink: formData.showRssLink,
    showApiLink: formData.showApiLink,
    uptimeExcellentThreshold: formData.uptimeExcellentThreshold,
    uptimeGoodThreshold: formData.uptimeGoodThreshold,
    themeId: formData.themeId,
    themeVersion: formData.themeVersion,
    themeDensity: formData.themeDensity,
  };
  const effectiveColorTheme = computeStatusPageTheme({
    primaryColor: formData.primaryColor,
    backgroundColor: formData.backgroundColor,
    textColor: formData.textColor,
  });
  const textContrastAdjusted =
    effectiveColorTheme.textColor.toLowerCase() !== formData.textColor.toLowerCase();
  const previewMaxWidth =
    formData.layout === 'wide' ? '1600px' : formData.layout === 'compact' ? '900px' : '1280px';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      ['announcements', 'integrations', 'subscribers', 'email-delivery'].includes(activeSection)
    ) {
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const brandingData = {
          version: 1 as const,
          logoUrl: formData.logoUrl,
          faviconUrl: formData.faviconUrl,
          primaryColor: formData.primaryColor,
          backgroundColor: formData.backgroundColor,
          textColor: formData.textColor,
          fontFamily: formData.fontFamily,
          customCss: formData.customCss,
          layout: formData.layout,
          showHeader: formData.showHeader,
          showFooter: formData.showFooter,
          metaTitle: formData.metaTitle,
          metaDescription: formData.metaDescription,
          autoRefresh: formData.autoRefresh,
          refreshInterval: formData.refreshInterval,
          showRssLink: formData.showRssLink,
          showApiLink: formData.showApiLink,
          themeId: formData.themeId,
          themeVersion: formData.themeVersion,
          themeDensity: formData.themeDensity,
        };

        const response = await fetch(
          `/api/settings/status-pages/${encodeURIComponent(statusPage.id)}/${activeSection}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              statusPageSectionPatch(activeSection, {
                id: statusPage.id,
                expectedUpdatedAt: revision,
                name: formData.name,
                slug: formData.slug || null,
                organizationName: formData.organizationName || null,
                subdomain: formData.subdomain || null,
                customDomain: formData.customDomain || null,
                enabled: formData.enabled,
                showServices: formData.showServices,
                showIncidents: formData.showIncidents,
                showMetrics: formData.showMetrics,
                showSubscribe: formData.showSubscribe,
                showServicesByRegion: formData.showServicesByRegion,
                uptimeExcellentThreshold: formData.uptimeExcellentThreshold,
                uptimeGoodThreshold: formData.uptimeGoodThreshold,
                footerText: formData.footerText || null,
                contactEmail: formData.contactEmail || null,
                contactUrl: formData.contactUrl || null,
                branding: brandingData,
                serviceIds: Array.from(selectedServices),
                serviceConfigs: serviceConfigs,
                // Privacy settings
                privacyMode: privacySettings.privacyMode,
                showIncidentDetails: privacySettings.showIncidentDetails,
                showIncidentTitles: privacySettings.showIncidentTitles,
                showIncidentDescriptions: privacySettings.showIncidentDescriptions,
                showAffectedServices: privacySettings.showAffectedServices,
                showIncidentTimestamps: privacySettings.showIncidentTimestamps,
                showServiceMetrics: privacySettings.showServiceMetrics,
                showServiceDescriptions: privacySettings.showServiceDescriptions,
                showServiceRegions: privacySettings.showServiceRegions,
                showTeamInformation: privacySettings.showTeamInformation,
                showCustomFields: privacySettings.showCustomFields,
                showIncidentAssignees: privacySettings.showIncidentAssignees,
                showIncidentUrgency: privacySettings.showIncidentUrgency,
                showUptimeHistory: privacySettings.showUptimeHistory,
                showRecentIncidents: privacySettings.showRecentIncidents,
                showIncidentHistoryDetails: privacySettings.showIncidentHistoryDetails,
                incidentHistoryDetailDays: privacySettings.incidentHistoryDetailDays,
                maxIncidentsToShow: privacySettings.maxIncidentsToShow,
                incidentHistoryDays: privacySettings.incidentHistoryDays,
                allowedCustomFields: privacySettings.allowedCustomFields,
                dataRetentionDays: privacySettings.dataRetentionDays,
                requireAuth: privacySettings.requireAuth,
                authProvider: privacySettings.authProvider,
                showServiceOwners: formData.showServiceOwners,
                showServiceSlaTier: formData.showServiceSlaTier,
                showChangelog: formData.showChangelog,
                showRegionHeatmap: formData.showRegionHeatmap,
                showPostIncidentReview: formData.showPostIncidentReview,
                enableUptimeExports: formData.enableUptimeExports,
                statusApiRequireToken: formData.statusApiRequireToken,
                statusApiRateLimitEnabled: formData.statusApiRateLimitEnabled,
                statusApiRateLimitMax: formData.statusApiRateLimitMax,
                statusApiRateLimitWindowSec: formData.statusApiRateLimitWindowSec,
              })
            ),
          }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save status page settings');
        }

        const saved = await response.json();
        if (typeof saved.data?.updatedAt === 'string') setRevision(saved.data.updatedAt);
        const state = saved.data?.publication ?? null;
        setPublication(state);
        const msg =
          state?.status === 'LIVE'
            ? 'Settings saved and published.'
            : state?.status === 'DISABLED'
              ? 'Settings saved. This status page is disabled, so it is not public.'
              : state?.status === 'PUBLISHING'
                ? 'Settings saved. Publishing to the public page…'
                : state?.status === 'FAILED'
                  ? null
                  : 'Settings saved.';
        if (msg) {
          // Success is centralized via the global toast. No ephemeral inline "saved" banner
          // — publication failure/pending is surfaced by the distinct persistent banner below.
          notify.success(msg, { id: `status-page:${statusPage.id}:${activeSection}:save` });
        }
        router.refresh();
      } catch (err: unknown) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setError(getUserFacingErrorMessage(err) || 'Failed to save settings');
      }
    });
  };

  const handleRetryPublication = async () => {
    setRetryingPublication(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/settings/status-pages/${encodeURIComponent(statusPage.id)}/publish`,
        { method: 'POST' }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Failed to republish the status page.');
      setPublication(payload?.data?.publication ?? null);
      router.refresh();
    } catch (err: unknown) {
      const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
      setError(getUserFacingErrorMessage(err) || 'Failed to republish the status page.');
    } finally {
      setRetryingPublication(false);
    }
  };

  const handleDeletePage = async () => {
    setError(null);
    const response = await fetch(
      `/api/settings/status-pages?id=${encodeURIComponent(statusPage.id)}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || 'Unable to delete status page.');
      return;
    }
    router.push('/settings/status-pages');
    router.refresh();
  };

  const handleMakeDefault = async () => {
    setError(null);
    const response = await fetch(
      `/api/settings/status-pages/${encodeURIComponent(statusPage.id)}/make-default`,
      { method: 'POST' }
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(payload?.error || 'Unable to change the default status page.');
      return;
    }
    setFormData(prev => ({ ...prev, isDefault: true }));
    router.refresh();
  };

  const updateServiceConfig = (
    serviceId: string,
    updates: Partial<{ displayName: string; order: number; showOnPage: boolean }>
  ) => {
    setServiceConfigs(prev => ({
      ...prev,
      [serviceId]: {
        ...prev[serviceId],
        ...updates,
      },
    }));
  };

  const handleLogoUpload = (file: File | null) => {
    if (!file) {
      return;
    }
    setLogoUploadError(null);

    const maxSizeBytes = 2 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setLogoUploadError('Logo file must be under 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:image/')) {
        setLogoUploadError('Unsupported image type.');
        return;
      }
      setFormData({ ...formData, logoUrl: result });
    };
    reader.onerror = () => {
      setLogoUploadError('Failed to read logo file.');
    };
    reader.readAsDataURL(file);
  };

  const handleCreateApiToken = (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    setApiTokenError(null);
    setApiTokenValue(null);

    const name = apiTokenName.trim();
    if (!name) {
      setApiTokenError('Token name is required.');
      return;
    }

    startApiTokenTransition(async () => {
      try {
        const response = await fetch('/api/settings/status-page/api-tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            statusPageId: statusPage.id,
            name,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create token');
        }

        const data = await response.json();
        if (data?.apiToken) {
          setApiTokens(current => [data.apiToken, ...current]);
        }
        setApiTokenValue(data?.token || null);
        setApiTokenName('');
      } catch (err: any) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setApiTokenError(getUserFacingErrorMessage(err) || 'Failed to create token');
      }
    });
  };

  const handleRevokeApiToken = (id: string) => {
    setApiTokenError(null);
    startApiTokenTransition(async () => {
      try {
        const response = await fetch('/api/settings/status-page/api-tokens', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, statusPageId: statusPage.id }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to revoke token');
        }

        const data = await response.json();
        if (data?.apiToken) {
          setApiTokens(current =>
            current.map(token =>
              token.id === id ? { ...token, revokedAt: data.apiToken.revokedAt } : token
            )
          );
        }
      } catch (err: any) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setApiTokenError(getUserFacingErrorMessage(err) || 'Failed to revoke token');
      }
    });
  };

  // Prepare privacy settings for preview
  const previewPrivacySettings = {
    privacyMode: privacySettings.privacyMode || 'PUBLIC',
    showIncidentDetails: privacySettings.showIncidentDetails !== false,
    showIncidentTitles: privacySettings.showIncidentTitles !== false,
    showIncidentDescriptions: privacySettings.showIncidentDescriptions !== false,
    showAffectedServices: privacySettings.showAffectedServices !== false,
    showIncidentTimestamps: privacySettings.showIncidentTimestamps !== false,
    showServiceMetrics: privacySettings.showServiceMetrics !== false,
    showServiceDescriptions: privacySettings.showServiceDescriptions !== false,
    showServiceRegions: privacySettings.showServiceRegions !== false,
    showTeamInformation: privacySettings.showTeamInformation || false,
    showCustomFields: privacySettings.showCustomFields || false,
    showIncidentAssignees: privacySettings.showIncidentAssignees || false,
    showIncidentUrgency: privacySettings.showIncidentUrgency !== false,
    showUptimeHistory: privacySettings.showUptimeHistory !== false,
    showRecentIncidents: privacySettings.showRecentIncidents !== false,
    showIncidentHistoryDetails: privacySettings.showIncidentHistoryDetails ?? true,
    incidentHistoryDetailDays: privacySettings.incidentHistoryDetailDays ?? 7,
    maxIncidentsToShow: privacySettings.maxIncidentsToShow || 50,
    incidentHistoryDays: privacySettings.incidentHistoryDays || 90,
    allowedCustomFields: privacySettings.allowedCustomFields || [],
    dataRetentionDays: privacySettings.dataRetentionDays || null,
    requireAuth: privacySettings.requireAuth !== false,
    authProvider: privacySettings.authProvider || null,
  };

  const previewDomain = useMemo(() => {
    if (formData.customDomain && formData.customDomain.trim()) {
      return formData.customDomain.trim();
    }
    if (formData.subdomain && formData.subdomain.trim()) {
      return `${formData.subdomain.trim()}.opsknight.com`;
    }
    if (formData.slug && formData.slug.trim()) {
      return `status-${formData.slug.trim()}.opsknight.com`;
    }
    return statusPage.slug ? `status-${statusPage.slug}.opsknight.com` : 'status.opsknight.com';
  }, [formData.customDomain, formData.subdomain, formData.slug, statusPage.slug]);

  const previewData = useMemo(() => {
    if (!showPreview) return null;
    return {
      statusPage: {
        name: formData.name,
        slug: formData.slug || statusPage.slug || null,
        subdomain: formData.subdomain || statusPage.subdomain || null,
        customDomain: formData.customDomain || statusPage.customDomain || null,
        contactEmail: formData.contactEmail || null,
        contactUrl: formData.contactUrl || null,
      },
      branding: previewBranding,
      services: previewServices,
      statusPageServices: previewStatusPageServices,
      announcements: previewAnnouncements.map((a: any) => {
        let startStr = new Date().toISOString();
        try {
          if (a.startDate) {
            const d = a.startDate instanceof Date ? a.startDate : new Date(a.startDate);
            if (!isNaN(d.getTime())) startStr = d.toISOString();
          }
        } catch {}
        let endStr: string | null = null;
        try {
          if (a.endDate) {
            const d = a.endDate instanceof Date ? a.endDate : new Date(a.endDate);
            if (!isNaN(d.getTime())) endStr = d.toISOString();
          }
        } catch {}
        return {
          ...a,
          startDate: startStr,
          endDate: endStr,
          allDay: a.allDay || a.timeMode === 'ALL_DAY',
          timeMode: a.timeMode || (a.allDay ? 'ALL_DAY' : 'EXACT'),
          affectedServices: buildAnnouncementAffectedServices(a.affectedServiceIds),
        };
      }),
      uptime90: previewUptime90,
      incidents: liveSnapshot?.incidents ?? [],
      regions: liveSnapshot?.regions,
      maintenance: liveSnapshot?.maintenance,
      showServices: formData.showServices,
      showIncidents: formData.showIncidents,
      showMetrics: formData.showMetrics,
      showSubscribe: formData.showSubscribe,
      showServicesByRegion: formData.showServicesByRegion,
      showServiceOwners: formData.showServiceOwners,
      showServiceSlaTier: formData.showServiceSlaTier,
      showChangelog: formData.showChangelog,
      showRegionHeatmap: formData.showRegionHeatmap,
      showPostIncidentReview: formData.showPostIncidentReview,
      showHeader: formData.showHeader,
      showFooter: formData.showFooter,
      footerText: formData.footerText || null,
      showRssLink: formData.showRssLink,
      showApiLink: formData.showApiLink,
      layout: formData.layout,
      privacySettings: previewPrivacySettings,
      enableUptimeExports: formData.enableUptimeExports,
      uptimeExcellentThreshold: formData.uptimeExcellentThreshold,
      uptimeGoodThreshold: formData.uptimeGoodThreshold,
    };
  }, [
    showPreview,
    formData,
    previewBranding,
    previewServices,
    previewStatusPageServices,
    previewAnnouncements,
    previewUptime90,
    previewPrivacySettings,
    statusPage.slug,
    statusPage.subdomain,
    statusPage.customDomain,
    liveSnapshot,
  ]);

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
                      ? 'is-active bg-primary text-primary-foreground border-primary shadow-xs font-semibold'
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
                        'ml-1 px-1.5 py-0 text-[10px] font-bold rounded-full',
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
                  ? 'bg-primary text-primary-foreground border-primary shadow-xs hover:bg-primary/90'
                  : 'bg-background hover:bg-muted text-foreground border-border shadow-xs'
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
              background: '#f9fafb',
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
                        browserTimeZone={browserTimeZone}
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
                          <StatusPageSubscribers statusPageId={statusPage.id} />
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
                      {activeSection === 'general' && (
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
                                  <span className="font-semibold text-foreground">
                                    Default routing:
                                  </span>{' '}
                                  {statusPage.isDefault
                                    ? 'This page serves /status and the legacy /api/status endpoint. It does not provide settings to other pages.'
                                    : 'This page is independent. Make it the default only to route legacy /status requests here.'}
                                </div>
                                {!statusPage.isDefault && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleMakeDefault}
                                  >
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
                                onChange={e =>
                                  setFormData({ ...formData, organizationName: e.target.value })
                                }
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
                                  onChange={checked =>
                                    setFormData(prev => ({ ...prev, enabled: checked }))
                                  }
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
                                onChange={e =>
                                  setFormData({ ...formData, subdomain: e.target.value })
                                }
                                placeholder="status"
                                helperText="e.g., status (for status.yourcompany.com)."
                              />

                              <FormField
                                type="input"
                                label="Custom Domain"
                                value={formData.customDomain}
                                onChange={e =>
                                  setFormData({ ...formData, customDomain: e.target.value })
                                }
                                placeholder="status.yourcompany.com"
                                helperText="Full custom domain pointing to your status page."
                              />
                            </div>
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
                                onChange={e =>
                                  setFormData({ ...formData, contactEmail: e.target.value })
                                }
                                placeholder="support@yourcompany.com"
                                helperText="Email address for users to contact you"
                              />

                              <FormField
                                type="input"
                                inputType="url"
                                label="Contact URL"
                                value={formData.contactUrl}
                                onChange={e =>
                                  setFormData({ ...formData, contactUrl: e.target.value })
                                }
                                placeholder="https://yourcompany.com/contact"
                                helperText="URL for contact page or support portal"
                              />
                            </div>
                          </StatusPageSectionCard>
                        </div>
                      )}

                      {/* Appearance Settings */}
                      {activeSection === 'appearance' && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-6)',
                          }}
                        >
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
                                  onChange={e =>
                                    setFormData({ ...formData, logoUrl: e.target.value })
                                  }
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
                                  <div className="text-[11px] text-muted-foreground mt-1">
                                    Uploads stored as data URLs. Max size 2MB.
                                  </div>
                                  {logoUploadError && (
                                    <div className="text-[11px] text-destructive mt-1 font-medium">
                                      {logoUploadError}
                                    </div>
                                  )}
                                </div>
                                {formData.logoUrl && (
                                  <div className="p-3 rounded-lg bg-muted/40 border border-border">
                                    <div className="text-xs font-semibold text-foreground mb-2">
                                      Logo Preview:
                                    </div>
                                    <div className="p-2.5 bg-background border border-border/80 rounded-md inline-block">
                                      <img
                                        src={formData.logoUrl}
                                        alt="Logo preview"
                                        className="h-10 max-w-[180px] object-contain"
                                        onError={e => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                          const parent = (e.target as HTMLImageElement)
                                            .parentElement;
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
                                  onChange={e =>
                                    setFormData({ ...formData, faviconUrl: e.target.value })
                                  }
                                  placeholder="https://yourcompany.com/favicon.ico"
                                  helperText="Recommended: 16x16 or 32x32px, ICO or PNG format."
                                />
                                {formData.faviconUrl && (
                                  <div className="p-3 rounded-lg bg-muted/40 border border-border">
                                    <div className="text-xs font-semibold text-foreground mb-2">
                                      Favicon Preview:
                                    </div>
                                    <div className="p-2 bg-background border border-border/80 rounded-md inline-block">
                                      <img
                                        src={formData.faviconUrl}
                                        alt="Favicon preview"
                                        className="w-8 h-8 object-contain"
                                        onError={e => {
                                          (e.target as HTMLImageElement).style.display = 'none';
                                          const parent = (e.target as HTMLImageElement)
                                            .parentElement;
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
                                onChange={e =>
                                  setFormData({ ...formData, fontFamily: e.target.value })
                                }
                                options={STATUS_PAGE_FONTS.map(f => ({
                                  value: f.id,
                                  label: `${f.name} (${f.category})`,
                                }))}
                                helperText="Applies clean typography to the header, incident reports, service metrics, and subscriber forms."
                              />
                              <div
                                style={{
                                  padding: 'var(--spacing-4)',
                                  borderRadius: 'var(--radius-md)',
                                  border: '1px solid #e2e8f0',
                                  background: '#ffffff',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px',
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: '11px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    color: 'var(--text-muted)',
                                    fontWeight: '600',
                                  }}
                                >
                                  Live Font Preview
                                </div>
                                <div
                                  style={{
                                    fontFamily:
                                      STATUS_PAGE_FONTS.find(
                                        f => f.id === (formData.fontFamily || 'default')
                                      )?.fontFamily || 'inherit',
                                    fontSize: '1.125rem',
                                    fontWeight: '700',
                                    color: '#0f172a',
                                  }}
                                >
                                  All Systems Operational — 99.98% 30-Day Uptime
                                </div>
                                <div
                                  style={{
                                    fontFamily:
                                      STATUS_PAGE_FONTS.find(
                                        f => f.id === (formData.fontFamily || 'default')
                                      )?.fontFamily || 'inherit',
                                    fontSize: '0.875rem',
                                    color: '#475569',
                                  }}
                                >
                                  Incident communication, automated health telemetry, and service
                                  status tracking.
                                </div>
                              </div>
                            </div>
                          </StatusPageSectionCard>

                          <StatusPageSectionCard
                            title="Color theme"
                            description="Start with an accessible preset, then adjust individual brand colors if needed. The preview uses the same color engine as the public page."
                            icon={<Palette className="w-5 h-5 text-primary" />}
                            action={
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  setFormData({
                                    ...formData,
                                    primaryColor: STATUS_PAGE_COLOR_PRESETS[0].primary,
                                    backgroundColor: STATUS_PAGE_COLOR_PRESETS[0].background,
                                    textColor: STATUS_PAGE_COLOR_PRESETS[0].text,
                                  })
                                }
                                className="text-xs gap-1.5 h-8 px-2.5 shadow-xs"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Reset to default</span>
                              </Button>
                            }
                          >
                            {/* Quick Presets */}
                            <div style={{ marginBottom: 'var(--spacing-5)' }}>
                              <label
                                style={{
                                  display: 'block',
                                  marginBottom: 'var(--spacing-2)',
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: '600',
                                }}
                              >
                                Theme presets
                              </label>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                                  gap: 'var(--spacing-2)',
                                }}
                              >
                                {STATUS_PAGE_COLOR_PRESETS.map(preset => {
                                  const isActive =
                                    formData.primaryColor === preset.primary &&
                                    formData.backgroundColor === preset.background &&
                                    formData.textColor === preset.text;
                                  return (
                                    <button
                                      key={preset.id}
                                      type="button"
                                      onClick={() =>
                                        setFormData({
                                          ...formData,
                                          primaryColor: preset.primary,
                                          backgroundColor: preset.background,
                                          textColor: preset.text,
                                        })
                                      }
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '8px 12px',
                                        borderRadius: 'var(--radius-md)',
                                        border: isActive
                                          ? '2px solid hsl(var(--ui-primary, 215.3 25% 26.7%))'
                                          : '1px solid hsl(var(--ui-border, 214.3 31.8% 91.4%))',
                                        background: isActive
                                          ? 'hsl(var(--ui-primary, 215.3 25% 26.7%) / 0.08)'
                                          : 'hsl(var(--ui-card, 0 0% 100%))',
                                        color: isActive
                                          ? 'hsl(var(--ui-primary, 215.3 25% 26.7%))'
                                          : 'inherit',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'all 0.15s ease',
                                      }}
                                    >
                                      <div style={{ display: 'flex', gap: '3px' }}>
                                        <span
                                          style={{
                                            width: '12px',
                                            height: '12px',
                                            borderRadius: '999px',
                                            background: preset.primary,
                                          }}
                                        />
                                        <span
                                          style={{
                                            width: '12px',
                                            height: '12px',
                                            borderRadius: '999px',
                                            background: preset.background,
                                            border: '1px solid #cbd5e1',
                                          }}
                                        />
                                        <span
                                          style={{
                                            width: '12px',
                                            height: '12px',
                                            borderRadius: '999px',
                                            background: preset.text,
                                          }}
                                        />
                                      </div>
                                      <span
                                        style={{
                                          fontSize: 'var(--font-size-xs)',
                                          fontWeight: isActive ? '700' : '500',
                                        }}
                                      >
                                        {preset.name}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <h3
                              style={{
                                margin: '0 0 var(--spacing-3)',
                                fontSize: 'var(--font-size-sm)',
                                fontWeight: '600',
                              }}
                            >
                              Custom colors
                            </h3>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                gap: 'var(--spacing-4)',
                              }}
                            >
                              <div>
                                <label
                                  style={{
                                    display: 'block',
                                    marginBottom: 'var(--spacing-2)',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: '500',
                                  }}
                                >
                                  Primary Color
                                </label>
                                <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                  <input
                                    type="color"
                                    value={formData.primaryColor}
                                    onChange={e =>
                                      setFormData({ ...formData, primaryColor: e.target.value })
                                    }
                                    style={{
                                      width: '60px',
                                      height: '40px',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 'var(--radius-md)',
                                      cursor: 'pointer',
                                    }}
                                  />
                                  <FormField
                                    type="input"
                                    inputType="text"
                                    label="Primary Color"
                                    value={formData.primaryColor}
                                    onChange={e =>
                                      setFormData({ ...formData, primaryColor: e.target.value })
                                    }
                                    placeholder="#667eea"
                                  />
                                </div>
                              </div>
                              <div>
                                <label
                                  style={{
                                    display: 'block',
                                    marginBottom: 'var(--spacing-2)',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: '500',
                                  }}
                                >
                                  Background Color
                                </label>
                                <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                  <input
                                    type="color"
                                    value={formData.backgroundColor}
                                    onChange={e =>
                                      setFormData({ ...formData, backgroundColor: e.target.value })
                                    }
                                    style={{
                                      width: '60px',
                                      height: '40px',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 'var(--radius-md)',
                                      cursor: 'pointer',
                                    }}
                                  />
                                  <FormField
                                    type="input"
                                    inputType="text"
                                    label="Background Color"
                                    value={formData.backgroundColor}
                                    onChange={e =>
                                      setFormData({ ...formData, backgroundColor: e.target.value })
                                    }
                                    placeholder="#ffffff"
                                  />
                                </div>
                              </div>
                              <div>
                                <label
                                  style={{
                                    display: 'block',
                                    marginBottom: 'var(--spacing-2)',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: '500',
                                  }}
                                >
                                  Text Color
                                </label>
                                <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                  <input
                                    type="color"
                                    value={formData.textColor}
                                    onChange={e =>
                                      setFormData({ ...formData, textColor: e.target.value })
                                    }
                                    style={{
                                      width: '60px',
                                      height: '40px',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 'var(--radius-md)',
                                      cursor: 'pointer',
                                    }}
                                  />
                                  <FormField
                                    type="input"
                                    inputType="text"
                                    label="Text Color"
                                    value={formData.textColor}
                                    onChange={e =>
                                      setFormData({ ...formData, textColor: e.target.value })
                                    }
                                    placeholder="#111827"
                                  />
                                </div>
                              </div>
                            </div>

                            <div
                              role="status"
                              className={cn(
                                'mt-4 p-3 rounded-lg text-xs leading-relaxed border',
                                textContrastAdjusted
                                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-900 dark:text-amber-200'
                                  : 'bg-primary/5 border-primary/20 text-foreground'
                              )}
                            >
                              {textContrastAdjusted
                                ? `Readable contrast applied: public text will render as ${effectiveColorTheme.textColor}.`
                                : 'Contrast check passed. These colors will render unchanged on the public page.'}
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
                                onChange={checked =>
                                  setFormData({ ...formData, showHeader: checked })
                                }
                                label="Show Header"
                                helperText={
                                  formData.showHeader
                                    ? 'Display the top navigation bar with logo and page title.'
                                    : 'When hidden, subscribe and API links remain accessible via the footer (if footer is enabled).'
                                }
                              />
                              <Switch
                                checked={formData.showFooter}
                                onChange={checked =>
                                  setFormData({ ...formData, showFooter: checked })
                                }
                                label="Show Footer"
                                helperText="Display the footer with support links, API links, and copyright."
                              />
                            </div>
                          </StatusPageSectionCard>
                        </div>
                      )}

                      {/* Design Settings */}
                      {activeSection === 'design' && (
                        <StatusPageDesignSection
                          themeId={formData.themeId}
                          density={formData.themeDensity}
                          customCss={formData.customCss}
                          onThemeChange={themeId => setFormData(prev => ({ ...prev, themeId }))}
                          onDensityChange={themeDensity =>
                            setFormData(prev => ({ ...prev, themeDensity }))
                          }
                          onCustomCssChange={customCss =>
                            setFormData(prev => ({ ...prev, customCss }))
                          }
                        />
                      )}

                      {/* Services Configuration */}
                      {activeSection === 'services' && (
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
                        />
                      )}

                      {/* Privacy Settings */}
                      {activeSection === 'privacy' && (
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
                      )}

                      {/* Content Settings */}
                      {activeSection === 'content' && (
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
                                    onChange={checked =>
                                      setFormData({ ...formData, showServices: checked })
                                    }
                                    label="Show Services"
                                    helperText="Display service status list (disabling hides all service cards from the page)"
                                  />
                                </div>
                                <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
                                  <Switch
                                    checked={formData.showIncidents}
                                    onChange={checked => {
                                      setFormData({ ...formData, showIncidents: checked });
                                      if (
                                        checked &&
                                        privacySettings.showRecentIncidents === false
                                      ) {
                                        setPrivacySettings(prev => ({
                                          ...prev,
                                          showRecentIncidents: true,
                                        }));
                                      }
                                    }}
                                    label="Show Incidents"
                                    helperText="Display incidents section and timeline"
                                  />
                                </div>
                                <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
                                  <Switch
                                    checked={formData.showMetrics}
                                    onChange={checked => {
                                      setFormData({ ...formData, showMetrics: checked });
                                      setPrivacySettings(prev => ({
                                        ...prev,
                                        showServiceMetrics: checked,
                                        showUptimeHistory: checked,
                                      }));
                                    }}
                                    label="Show Uptime & Availability"
                                    helperText="Display service uptime metrics and history"
                                  />
                                </div>
                                <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
                                  <Switch
                                    checked={formData.showSubscribe}
                                    onChange={checked =>
                                      setFormData({ ...formData, showSubscribe: checked })
                                    }
                                    label="Show Subscribe to Updates"
                                    helperText="Display email subscription section"
                                  />
                                </div>
                                <div className="p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/20 transition-colors">
                                  <Switch
                                    checked={formData.showChangelog}
                                    onChange={checked =>
                                      setFormData({ ...formData, showChangelog: checked })
                                    }
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
                                        setPrivacySettings((prev: any) => ({
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
                                    onChange={checked =>
                                      setFormData({ ...formData, showPostIncidentReview: checked })
                                    }
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
                                    background: '#f9fafb',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid #e5e7eb',
                                  }}
                                >
                                  <h4
                                    style={{
                                      fontSize: 'var(--font-size-sm)',
                                      fontWeight: '600',
                                      marginBottom: 'var(--spacing-3)',
                                      color: '#374151',
                                    }}
                                  >
                                    Uptime Thresholds
                                  </h4>
                                  <p
                                    style={{
                                      fontSize: 'var(--font-size-xs)',
                                      color: '#6b7280',
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
                                  {formData.uptimeGoodThreshold >
                                    formData.uptimeExcellentThreshold && (
                                    <div className="mt-3 px-3 py-2 rounded-md text-xs font-medium bg-destructive/10 border border-destructive/25 text-destructive">
                                      ⚠️ Good threshold must be less than or equal to Excellent
                                      threshold
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
                              onChange={e =>
                                setFormData({ ...formData, footerText: e.target.value })
                              }
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
                                onChange={e =>
                                  setFormData({ ...formData, metaTitle: e.target.value })
                                }
                                placeholder={statusPage.name}
                                helperText="Recommended: 50-60 characters"
                              />
                              <FormField
                                type="textarea"
                                label="Meta Description"
                                rows={2}
                                value={formData.metaDescription}
                                onChange={e =>
                                  setFormData({ ...formData, metaDescription: e.target.value })
                                }
                                placeholder={`Status page for ${statusPage.name}`}
                                helperText="Recommended: 150-160 characters"
                              />
                            </div>
                          </StatusPageSectionCard>
                        </div>
                      )}

                      {/* Advanced Settings */}
                      {activeSection === 'advanced' && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-6)',
                          }}
                        >
                          <StatusPageSectionCard
                            title="Live Updates & Feeds"
                            description="Configure client-side polling intervals and public RSS/JSON feed discovery."
                            icon={<RefreshCw className="w-5 h-5 text-primary" />}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--spacing-4)',
                              }}
                            >
                              <Switch
                                checked={formData.autoRefresh}
                                onChange={checked =>
                                  setFormData({ ...formData, autoRefresh: checked })
                                }
                                label="Enable Auto-Refresh"
                                helperText="Automatically refresh the status page at regular intervals"
                              />
                              {formData.autoRefresh && (
                                <FormField
                                  type="input"
                                  label="Refresh Interval (seconds)"
                                  value={formData.refreshInterval.toString()}
                                  onChange={e =>
                                    setFormData({
                                      ...formData,
                                      refreshInterval: parseInt(e.target.value) || 60,
                                    })
                                  }
                                  placeholder="60"
                                  helperText="How often to refresh the page (minimum: 30 seconds)"
                                />
                              )}
                              <div
                                style={{
                                  borderTop: '1px solid #e5e7eb',
                                  paddingTop: 'var(--spacing-3)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 'var(--spacing-3)',
                                }}
                              >
                                <Switch
                                  checked={formData.showRssLink}
                                  onChange={checked =>
                                    setFormData({ ...formData, showRssLink: checked })
                                  }
                                  label="Show RSS Feed Link"
                                  helperText="Display link to RSS feed in footer"
                                />
                                <Switch
                                  checked={formData.showApiLink}
                                  onChange={checked =>
                                    setFormData({ ...formData, showApiLink: checked })
                                  }
                                  label="Show JSON API Link"
                                  helperText="Display link to JSON API in footer"
                                />
                              </div>
                            </div>
                          </StatusPageSectionCard>

                          <StatusPageSectionCard
                            title="Status API Access & Security"
                            description="Token authentication and rate limiting for JSON and RSS endpoints."
                            icon={<Key className="w-5 h-5 text-primary" />}
                          >
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--spacing-4)',
                              }}
                            >
                              <Switch
                                checked={formData.statusApiRequireToken}
                                onChange={checked =>
                                  setFormData({ ...formData, statusApiRequireToken: checked })
                                }
                                label="Require API token"
                                helperText="Require a token for JSON and RSS endpoints."
                              />
                              <Switch
                                checked={formData.statusApiRateLimitEnabled}
                                onChange={checked =>
                                  setFormData({ ...formData, statusApiRateLimitEnabled: checked })
                                }
                                label="Enable rate limiting"
                                helperText="Throttle API access to protect the status page."
                              />
                              {formData.statusApiRateLimitEnabled && (
                                <div
                                  style={{
                                    display: 'grid',
                                    gap: 'var(--spacing-3)',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                                  }}
                                >
                                  <FormField
                                    type="input"
                                    label="Max requests"
                                    value={String(formData.statusApiRateLimitMax)}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                      const val = parseInt(e.target.value, 10);
                                      if (!Number.isNaN(val)) {
                                        setFormData({ ...formData, statusApiRateLimitMax: val });
                                      }
                                    }}
                                    helperText="Requests per window"
                                  />
                                  <FormField
                                    type="input"
                                    label="Window (seconds)"
                                    value={String(formData.statusApiRateLimitWindowSec)}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                      const val = parseInt(e.target.value, 10);
                                      if (!Number.isNaN(val)) {
                                        setFormData({
                                          ...formData,
                                          statusApiRateLimitWindowSec: val,
                                        });
                                      }
                                    }}
                                    helperText="Minimum 10 seconds"
                                  />
                                </div>
                              )}
                              <div
                                style={{
                                  borderTop: '1px solid #e5e7eb',
                                  paddingTop: 'var(--spacing-4)',
                                }}
                              >
                                <h3
                                  style={{
                                    fontSize: 'var(--font-size-base)',
                                    fontWeight: '600',
                                    marginBottom: 'var(--spacing-3)',
                                  }}
                                >
                                  API tokens
                                </h3>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 'var(--spacing-3)',
                                    alignItems: 'flex-end',
                                  }}
                                >
                                  <div
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleCreateApiToken(e);
                                      }
                                    }}
                                  >
                                    <FormField
                                      type="input"
                                      label="Token name"
                                      value={apiTokenName}
                                      onChange={e => setApiTokenName(e.target.value)}
                                      placeholder="e.g. External status monitor"
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="primary"
                                    isLoading={apiTokenPending}
                                    onClick={handleCreateApiToken}
                                  >
                                    Create token
                                  </Button>
                                </div>
                                {apiTokenError && (
                                  <div
                                    style={{
                                      marginTop: 'var(--spacing-2)',
                                      fontSize: 'var(--font-size-sm)',
                                      color: 'var(--color-error-dark)',
                                    }}
                                  >
                                    {apiTokenError}
                                  </div>
                                )}
                                {apiTokenValue && (
                                  <div
                                    style={{
                                      marginTop: 'var(--spacing-3)',
                                      padding: 'var(--spacing-3)',
                                      borderRadius: 'var(--radius-md)',
                                      background: '#ecfdf5',
                                      border: '1px solid #a7f3d0',
                                      color: '#065f46',
                                      fontSize: 'var(--font-size-sm)',
                                    }}
                                  >
                                    Copy this token now. You will not be able to view it again.
                                    <div
                                      style={{
                                        marginTop: 'var(--spacing-2)',
                                        fontFamily: 'monospace',
                                        wordBreak: 'break-all',
                                      }}
                                    >
                                      {apiTokenValue}
                                    </div>
                                  </div>
                                )}
                                <div
                                  style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 'var(--spacing-2)',
                                    marginTop: 'var(--spacing-4)',
                                  }}
                                >
                                  {apiTokens.length === 0 ? (
                                    <p
                                      style={{
                                        fontSize: 'var(--font-size-sm)',
                                        color: 'var(--text-muted)',
                                      }}
                                    >
                                      No API tokens created yet.
                                    </p>
                                  ) : (
                                    apiTokens.map(token => (
                                      <div
                                        key={token.id}
                                        style={{
                                          padding: 'var(--spacing-3)',
                                          borderRadius: 'var(--radius-md)',
                                          border: '1px solid #e5e7eb',
                                          background: '#f9fafb',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 'var(--spacing-3)',
                                          flexWrap: 'wrap',
                                        }}
                                      >
                                        <div>
                                          <div style={{ fontWeight: '600' }}>{token.name}</div>
                                          <div
                                            style={{
                                              fontSize: 'var(--font-size-xs)',
                                              color: 'var(--text-muted)',
                                            }}
                                          >
                                            Prefix: {token.prefix} · Created{' '}
                                            {formatDateTime(token.createdAt, browserTimeZone, {
                                              format: 'date',
                                            })}
                                          </div>
                                          {token.lastUsedAt && (
                                            <div
                                              style={{
                                                fontSize: 'var(--font-size-xs)',
                                                color: 'var(--text-muted)',
                                              }}
                                            >
                                              Last used{' '}
                                              {formatDateTime(token.lastUsedAt, browserTimeZone, {
                                                format: 'date',
                                              })}
                                            </div>
                                          )}
                                        </div>
                                        <Button
                                          type="button"
                                          variant="secondary"
                                          onClick={() => handleRevokeApiToken(token.id)}
                                          isLoading={apiTokenPending}
                                          disabled={Boolean(token.revokedAt)}
                                        >
                                          {token.revokedAt ? 'Revoked' : 'Revoke'}
                                        </Button>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            </div>
                          </StatusPageSectionCard>

                          <StatusPageSectionCard
                            title="Uptime Reports & Endpoints"
                            description="Public uptime report downloads and external feed endpoints."
                            icon={<Rss className="w-5 h-5 text-primary" />}
                          >
                            <Switch
                              checked={formData.enableUptimeExports}
                              onChange={checked =>
                                setFormData({ ...formData, enableUptimeExports: checked })
                              }
                              label="Enable public uptime exports"
                              helperText="Allow visitors and admins to download monthly uptime reports (CSV/PDF) directly from the Status Page."
                            />
                            {formData.enableUptimeExports && (
                              <div
                                style={{
                                  marginTop: 'var(--spacing-4)',
                                  padding: 'var(--spacing-3)',
                                  borderRadius: 'var(--radius-md)',
                                  border: '1px solid #e5e7eb',
                                  background: '#f9fafb',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 'var(--spacing-3)',
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 'var(--font-size-sm)',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  Download the latest uptime export directly from the status API.
                                </div>
                                <div
                                  style={{
                                    display: 'flex',
                                    gap: 'var(--spacing-2)',
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  <a
                                    href={`/api/status/uptime-export?format=csv&statusPageId=${statusPage.id}`}
                                    className="glass-button"
                                    style={{ padding: '0.5rem 1rem', textDecoration: 'none' }}
                                  >
                                    Download CSV
                                  </a>
                                  <a
                                    href={`/api/status/uptime-export?format=pdf&statusPageId=${statusPage.id}`}
                                    className="glass-button"
                                    style={{ padding: '0.5rem 1rem', textDecoration: 'none' }}
                                  >
                                    Download PDF
                                  </a>
                                </div>
                              </div>
                            )}

                            <div
                              style={{
                                marginTop: 'var(--spacing-5)',
                                borderTop: '1px solid #e5e7eb',
                                paddingTop: 'var(--spacing-4)',
                              }}
                            >
                              <h4
                                style={{
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: '600',
                                  marginBottom: 'var(--spacing-3)',
                                }}
                              >
                                API & Feed URLs
                              </h4>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                                  gap: 'var(--spacing-3)',
                                }}
                              >
                                <div
                                  style={{
                                    padding: 'var(--spacing-3)',
                                    background: '#f9fafb',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 'var(--font-size-xs)',
                                      color: 'var(--text-muted)',
                                      marginBottom: 'var(--spacing-1)',
                                    }}
                                  >
                                    JSON API
                                  </div>
                                  <code
                                    style={{
                                      fontSize: 'var(--font-size-sm)',
                                      color: 'var(--text-primary)',
                                    }}
                                  >
                                    {typeof window !== 'undefined' ? window.location.origin : ''}
                                    /api/status
                                  </code>
                                </div>
                                <div
                                  style={{
                                    padding: 'var(--spacing-3)',
                                    background: '#f9fafb',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 'var(--font-size-xs)',
                                      color: 'var(--text-muted)',
                                      marginBottom: 'var(--spacing-1)',
                                    }}
                                  >
                                    RSS Feed
                                  </div>
                                  <code
                                    style={{
                                      fontSize: 'var(--font-size-sm)',
                                      color: 'var(--text-primary)',
                                    }}
                                  >
                                    {typeof window !== 'undefined' ? window.location.origin : ''}
                                    /api/status/rss
                                  </code>
                                </div>
                              </div>
                            </div>
                          </StatusPageSectionCard>
                        </div>
                      )}

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
              <div className="status-page-config-sticky-bar flex items-center justify-between gap-3 px-5 py-3.5 border-t border-border bg-card/95 backdrop-blur-md shadow-lg">
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
                        className="text-xs font-semibold gap-1.5 shadow-xs"
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
                    className="text-xs font-semibold shadow-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    form="status-page-section-form"
                    variant="primary"
                    size="sm"
                    isLoading={isPending}
                    className="text-xs font-semibold gap-1.5 shadow-sm"
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
