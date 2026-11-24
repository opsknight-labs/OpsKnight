'use client';
/* eslint-disable @typescript-eslint/no-explicit-any, security/detect-object-injection */

import {
  useState,
  useTransition,
  useMemo,
  type FormEvent,
  type SyntheticEvent,
  type ReactNode,
} from 'react';
import { statusPageSectionPatch } from '@/lib/status-pages/settings-sections';
import { notify } from '@/lib/toast';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { type PrivacySettings } from '@/components/status-page/StatusPagePrivacySettings';
import {
  type BusinessServiceOption,
  type BusinessServicePageConfig,
  type StatusPageServiceLayout,
} from '@/components/status-page/StatusPageBusinessLayout';
import {
  Settings,
  Wrench,
  Shield,
  Link2,
  Mail,
  Palette,
  Sliders,
  Megaphone,
  Users,
  FileText,
} from 'lucide-react';
import {
  STATUS_PAGE_THEME_VERSION,
  resolveStatusPageTheme,
  resolveStatusPageThemeDensity,
  resolveStatusPageColorScheme,
  type StatusPageColorScheme,
  type StatusPageThemeDensity,
} from '@/lib/status-pages/theme-contract';
import {
  MAX_IP_ALLOW_ENTRIES,
  isValidIpAllowEntry,
  normalizeIpAllowList,
} from '@/lib/status-pages/ip-allow-list';

export type StatusPageBranding = {
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
  colorScheme?: StatusPageColorScheme;
  showSlaMetrics?: boolean;
  showServiceMeta?: boolean;
};

export function isStatusPageBranding(value: unknown): value is StatusPageBranding {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type StatusPageConfigProps = {
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
    serviceLayout?: StatusPageServiceLayout;
    businessServices?: Array<{
      businessServiceId: string;
      order: number;
      displayName?: string | null;
      showOnPage?: boolean;
      showMembers?: boolean;
      statusOverride?: string | null;
      statusOverrideUntil?: string | Date | null;
    }>;
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
    updateCadenceMinutes?: number | null;
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
    ipAllowList?: string[];
    uptimeExcellentThreshold?: number;
    uptimeGoodThreshold?: number;
    services: Array<{
      id: string;
      serviceId: string;
      displayName?: string | null;
      showOnPage: boolean;
      order: number;
      /** True while the row exists only because a business service on the page contains it. */
      viaBusinessService?: boolean;
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
  /** Business services the page can group by. */
  allBusinessServices?: BusinessServiceOption[];
  liveSnapshot?: any;
  /** From an incident's "Post status update": open Announcements with that incident's draft. */
  draftIncidentId?: string;
};

export const normalizeAnnouncementServiceIds = (value?: string[] | null) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(id => id.trim()).filter(Boolean);
};

export function useStatusPageConfigState({
  statusPage,
  allServices,
  allBusinessServices,
  liveSnapshot,
  draftIncidentId,
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
  const [activeSection, setActiveSection] = useState(draftIncidentId ? 'announcements' : 'general');
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
    colorScheme: resolveStatusPageColorScheme(branding.colorScheme),
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
    showSlaMetrics: branding.showSlaMetrics !== false,
    showServiceMeta: branding.showServiceMeta === true,
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
    icon?: ReactNode;
    badge?: number;
    link?: string;
  };

  // Sidebar items - defined after announcements state
  const sidebarItems: SidebarItem[] = [
    { id: 'general', label: 'General', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-3.5 h-3.5" /> },
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
  const getInitialBusinessServiceIds = () =>
    [...(statusPage.businessServices ?? [])]
      .sort((a, b) => a.order - b.order)
      .map(mapping => mapping.businessServiceId);
  const [serviceLayout, setServiceLayout] = useState<StatusPageServiceLayout>(
    statusPage.serviceLayout ?? 'FLAT'
  );
  const [businessServiceIds, setBusinessServiceIds] = useState<string[]>(
    getInitialBusinessServiceIds
  );
  const getInitialBusinessServiceConfigs = () =>
    Object.fromEntries(
      (statusPage.businessServices ?? []).map(mapping => [
        mapping.businessServiceId,
        {
          displayName: mapping.displayName ?? '',
          showOnPage: mapping.showOnPage !== false,
          showMembers: mapping.showMembers !== false,
        },
      ])
    ) as Record<string, BusinessServicePageConfig>;
  const [businessServiceConfigs, setBusinessServiceConfigs] = useState(
    getInitialBusinessServiceConfigs
  );
  const businessServiceOverrides = Object.fromEntries(
    (statusPage.businessServices ?? []).map(mapping => [
      mapping.businessServiceId,
      {
        status: mapping.statusOverride ?? null,
        until: mapping.statusOverrideUntil
          ? new Date(mapping.statusOverrideUntil).toISOString()
          : null,
      },
    ])
  );

  const [serviceConfigs, setServiceConfigs] =
    useState<Record<string, { displayName: string; order: number; showOnPage: boolean }>>(
      getInitialServiceConfigs
    );

  const serviceLookup = new Map(allServices.map(service => [service.id, service] as const));

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

  const [ipAllowListText, setIpAllowListText] = useState(() =>
    (statusPage.ipAllowList ?? []).join('\n')
  );
  const ipAllowListEntries = normalizeIpAllowList(ipAllowListText.split(/[\n,]+/));
  const ipAllowListInvalid = ipAllowListEntries.filter(entry => !isValidIpAllowEntry(entry));

  const handleDiscardChanges = () => {
    setIpAllowListText((statusPage.ipAllowList ?? []).join('\n'));
    setFormData(getInitialFormData());
    setPrivacySettings(getInitialPrivacySettings());
    setSelectedServices(getInitialSelectedServices());
    setServiceConfigs(getInitialServiceConfigs());
    setServiceLayout(statusPage.serviceLayout ?? 'FLAT');
    setBusinessServiceIds(getInitialBusinessServiceIds());
    setBusinessServiceConfigs(getInitialBusinessServiceConfigs());
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
    colorScheme: formData.colorScheme,
    showSlaMetrics: formData.showSlaMetrics,
    showServiceMeta: formData.showServiceMeta,
  };
  const previewMaxWidth =
    formData.layout === 'wide' ? '1600px' : formData.layout === 'compact' ? '900px' : '1280px';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      ['announcements', 'integrations', 'subscribers', 'email-delivery'].includes(activeSection)
    ) {
      return;
    }
    if (ipAllowListInvalid.length > 0 || ipAllowListEntries.length > MAX_IP_ALLOW_ENTRIES) {
      setError(
        ipAllowListInvalid.length > 0
          ? `Fix the IP allow-list before saving: ${ipAllowListInvalid.slice(0, 3).join(', ')} is not a valid address or CIDR range.`
          : `The IP allow-list can hold at most ${MAX_IP_ALLOW_ENTRIES} entries.`
      );
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
          colorScheme: formData.colorScheme,
          showSlaMetrics: formData.showSlaMetrics,
          showServiceMeta: formData.showServiceMeta,
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
                serviceLayout,
                businessServiceIds,
                // Only rows that will exist after the save; new rows take the defaults first.
                businessServiceConfigs: Object.fromEntries(
                  businessServiceIds.flatMap(id =>
                    businessServiceConfigs[id] ? [[id, businessServiceConfigs[id]]] : []
                  )
                ),
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
                ipAllowList: ipAllowListEntries,
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

  const handleCreateApiToken = (e?: SyntheticEvent) => {
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

  // Inputs (branding, services, privacy) are rebuilt each render, so a memo here never cached.
  const previewData = (() => {
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
  })();

  return {
    ipAllowListText,
    setIpAllowListText,
    ipAllowListEntries,
    ipAllowListInvalid,
    browserTimeZone,
    router,
    isPending,
    startTransition,
    error,
    setError,
    publication,
    setPublication,
    retryingPublication,
    setRetryingPublication,
    activeSection,
    setActiveSection,
    showPreview,
    setShowPreview,
    logoUploadError,
    setLogoUploadError,
    revision,
    setRevision,
    branding,
    getInitialFormData,
    formData,
    setFormData,
    announcements,
    setAnnouncements,
    apiTokens,
    setApiTokens,
    apiTokenName,
    setApiTokenName,
    apiTokenValue,
    setApiTokenValue,
    apiTokenError,
    setApiTokenError,
    apiTokenPending,
    startApiTokenTransition,
    sidebarItems,
    getInitialSelectedServices,
    getInitialServiceConfigs,
    selectedServices,
    setSelectedServices,
    getInitialBusinessServiceIds,
    serviceLayout,
    setServiceLayout,
    businessServiceIds,
    setBusinessServiceIds,
    getInitialBusinessServiceConfigs,
    businessServiceConfigs,
    setBusinessServiceConfigs,
    businessServiceOverrides,
    serviceConfigs,
    setServiceConfigs,
    serviceLookup,
    buildAnnouncementAffectedServices,
    getInitialPrivacySettings,
    privacySettings,
    setPrivacySettings,
    handleDiscardChanges,
    selectedServiceIds,
    announcementServiceOptions,
    hasSelectedRegions,
    previewServiceIds,
    previewServices,
    previewStatusPageServices,
    previewUptime90,
    today,
    previewAnnouncements,
    previewBranding,
    previewMaxWidth,
    handleSubmit,
    handleRetryPublication,
    handleDeletePage,
    handleMakeDefault,
    updateServiceConfig,
    handleLogoUpload,
    handleCreateApiToken,
    handleRevokeApiToken,
    previewPrivacySettings,
    previewDomain,
    previewData,
    statusPage,
    allServices,
    allBusinessServices,
    liveSnapshot,
    draftIncidentId,
  };
}

export type StatusPageConfigState = ReturnType<typeof useStatusPageConfigState>;
