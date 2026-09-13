'use client';
/* eslint-disable @typescript-eslint/no-explicit-any, security/detect-object-injection, @next/next/no-img-element */

import { useEffect, useRef, useState, useTransition, useMemo } from 'react';
import { statusPageSectionPatch } from '@/lib/status-pages/settings-sections';
import { Card, Button, FormField, Switch, Checkbox } from '@/components/ui';
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
import DangerZoneCard from '@/components/settings/DangerZoneCard';
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
  Type,
  Layout,
  Image as ImageIcon,
  CheckSquare,
  Sliders,
  Megaphone,
  Bell,
  Users,
  Code,
  RefreshCw,
  Rss,
  Key,
  FileText,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { STATUS_PAGE_FONTS } from '@/lib/status-page-theme';
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

type TemplateCategory = 'professional' | 'colorful' | 'dark' | 'pastel' | 'minimal';

type StatusPageTemplate = {
  id: string;
  name: string;
  file: string;
  colors: string[];
  category: TemplateCategory;
};

const TEMPLATE_FILTERS: Array<{ id: 'all' | TemplateCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'professional', label: 'Professional' },
  { id: 'colorful', label: 'Colorful' },
  { id: 'dark', label: 'Dark' },
  { id: 'pastel', label: 'Pastel' },
  { id: 'minimal', label: 'Minimal' },
];

// Legacy template metadata is retained only so older in-memory customization state remains safe
// while the UI migrates to curated Design themes. The legacy section is no longer navigable.
const STATUS_PAGE_TEMPLATES: StatusPageTemplate[] = [];

export default function StatusPageConfig({
  statusPage,
  allServices,
  liveSnapshot,
}: StatusPageConfigProps) {
  const { browserTimeZone } = useTimezone();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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
  const [templateLoadingId, setTemplateLoadingId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateAppliedNotice, setTemplateAppliedNotice] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState<'all' | TemplateCategory>('all');
  const [templateCssMap, setTemplateCssMap] = useState<Record<string, string>>({});
  const templateFetchRef = useRef<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [revision, setRevision] = useState(() =>
    statusPage.updatedAt ? new Date(statusPage.updatedAt).toISOString() : undefined
  );

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
    logoUrl: branding.logoUrl || branding.logo || '/logo.svg',
    faviconUrl: branding.faviconUrl || '',
    primaryColor: branding.primaryColor || branding.primary || '#667eea',
    backgroundColor: branding.backgroundColor || branding.background || '#ffffff',
    textColor: branding.textColor || branding.text || '#111827',
    fontFamily: branding.fontFamily || 'default',
    themeId: resolveStatusPageTheme(branding.themeId).id,
    themeDensity: resolveStatusPageThemeDensity(branding.themeDensity),
    customCss: branding.customCss || '',
    layout: branding.layout || 'default',
    showHeader: branding.showHeader !== false,
    showFooter: branding.showFooter !== false,
    metaTitle: branding.metaTitle || statusPage.name,
    metaDescription: branding.metaDescription || `Status page for ${statusPage.name}`,
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
  const [announcements, setAnnouncements] = useState(statusPage.announcements);
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

  const sidebarItems: SidebarItem[] = [
    { id: 'general', label: 'General', icon: <Settings className="w-3.5 h-3.5" /> },
    { id: 'appearance', label: 'Appearance', icon: <Palette className="w-3.5 h-3.5" /> },
    { id: 'design', label: 'Design', icon: <Code className="w-3.5 h-3.5" /> },
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
    if (!Array.isArray(value)) return [];
    return value.map(id => id.trim()).filter(Boolean);
  };

  const buildAnnouncementAffectedServices = (value?: string[] | null) => {
    const ids = normalizeAnnouncementServiceIds(value);
    return ids
      .map(id => serviceLookup.get(id))
      .filter(Boolean)
      .map(service => ({ id: service!.id, name: service!.name, region: service!.region ?? null }));
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
    setTemplateAppliedNotice(null);
    setSelectedTemplateId(null);
    setTemplateError(null);
    setError(null);
    router.refresh();
  };

  const selectedServiceIds = Array.from(selectedServices);
  const announcementServiceOptions = allServices.filter(service =>
    selectedServices.has(service.id)
  );
  const hasSelectedRegions = allServices.some(
    service => selectedServices.has(service.id) && Boolean(service.region && service.region.trim())
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
      if (!announcement.isActive) return false;
      if (!announcement.endDate) return true;
      return announcement.endDate >= today;
    });

  const selectedTheme = resolveStatusPageTheme(formData.themeId);
  const themePrimary =
    selectedTheme.id !== 'default'
      ? selectedTheme.preview.accent
      : formData.primaryColor || '#667eea';
  const themeBg =
    selectedTheme.id !== 'default'
      ? selectedTheme.preview.surfaceAlt
      : formData.backgroundColor || '#ffffff';
  const themeText =
    selectedTheme.id !== 'default' ? selectedTheme.preview.text : formData.textColor || '#111827';

  const previewBranding = {
    logoUrl: formData.logoUrl,
    faviconUrl: formData.faviconUrl,
    primaryColor: themePrimary,
    backgroundColor: themeBg,
    textColor: themeText,
    fontFamily: formData.fontFamily,
    themeId: formData.themeId,
    themeVersion: STATUS_PAGE_THEME_VERSION,
    themeDensity: formData.themeDensity,
    customCss: formData.customCss,
    layout: formData.layout,
    showHeader: formData.showHeader,
    showFooter: formData.showFooter,
    showRssLink: formData.showRssLink,
    showApiLink: formData.showApiLink,
    uptimeExcellentThreshold: formData.uptimeExcellentThreshold,
    uptimeGoodThreshold: formData.uptimeGoodThreshold,
  };
  const previewMaxWidth =
    formData.layout === 'wide' ? '1600px' : formData.layout === 'compact' ? '900px' : '1280px';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const brandingData = {
          version: 1 as const,
          logoUrl: formData.logoUrl,
          faviconUrl: formData.faviconUrl,
          primaryColor: themePrimary,
          backgroundColor: themeBg,
          textColor: themeText,
          fontFamily: formData.fontFamily,
          themeId: formData.themeId,
          themeVersion: STATUS_PAGE_THEME_VERSION,
          themeDensity: formData.themeDensity,
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
          notify.success(msg, { id: `status-page:${statusPage.id}:${activeSection}:save` });
        }
        setTemplateAppliedNotice(null);
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
      [serviceId]: { ...prev[serviceId], ...updates },
    }));
  };

  const handleLogoUpload = (file: File | null) => {
    if (!file) return;
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
    reader.onerror = () => setLogoUploadError('Failed to read logo file.');
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
          body: JSON.stringify({ statusPageId: statusPage.id, name }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create token');
        }
        const data = await response.json();
        if (data?.apiToken) setApiTokens(current => [data.apiToken, ...current]);
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

  const getTemplateGradient = (colors: string[]) => {
    const primary = colors[0] || '#ffffff';
    const secondary = colors[1] || primary;
    const tertiary = colors[2] || secondary;
    return `linear-gradient(135deg, ${primary} 0%, ${secondary} 55%, ${tertiary} 100%)`;
  };

  const visibleTemplates =
    templateFilter === 'all'
      ? STATUS_PAGE_TEMPLATES
      : STATUS_PAGE_TEMPLATES.filter(template => template.category === templateFilter);
  const selectedTemplate = selectedTemplateId
    ? STATUS_PAGE_TEMPLATES.find(template => template.id === selectedTemplateId)
    : null;

  const buildTemplatePreviewHtml = (css: string, name: string) => `
<!doctype html><html><head><meta charset="utf-8" /><style>
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif}
.preview-root{min-height:100%}.status-page-container{min-height:100%;padding:10px}.status-page-header{padding:10px;display:flex;justify-content:space-between;align-items:center;gap:8px}.status-page-header h1{font-size:13px;margin:0}.status-page-header p{margin:4px 0 0;font-size:9px}.status-page-header a{font-size:9px;text-decoration:none;padding:4px 8px;border-radius:999px}main{padding:8px;display:flex;flex-direction:column;gap:6px}h2{font-size:10px;margin:0;text-transform:uppercase;letter-spacing:.06em}.status-service-card,.status-incident-card{padding:8px;border-radius:10px}.status-service-card div,.status-incident-card div{font-size:10px;font-weight:600}.status-announce-card{padding:8px;border-radius:10px;border:1px solid rgba(15,23,42,.08)}.status-announce-card div{font-size:10px;font-weight:600}.status-metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.status-metric{padding:6px;border-radius:8px;border:1px solid rgba(15,23,42,.08);font-size:9px;text-align:center}.status-legend{display:flex;gap:6px;font-size:9px}.status-dot{width:6px;height:6px;border-radius:999px;display:inline-block;margin-right:4px}footer{margin-top:6px;font-size:9px;text-align:center}form{margin-top:4px}form button{width:100%;padding:6px;font-size:9px;border-radius:10px}
</style><style>${css}</style></head><body><div class="preview-root"><div class="status-page-container"><header class="status-page-header"><div><h1>${name}</h1><p>All systems operational</p></div><a href="#">Contact</a></header><main><h2>Announcements</h2><div class="status-announce-card"><div>Planned maintenance</div></div><h2>Services</h2><div class="status-service-card"><div>API Gateway</div></div><div class="status-legend"><span><span class="status-dot" style="background:#22c55e"></span>Operational</span><span><span class="status-dot" style="background:#f59e0b"></span>Degraded</span><span><span class="status-dot" style="background:#ef4444"></span>Outage</span></div><h2>Metrics</h2><div class="status-metric-row"><div class="status-metric">Latency 120ms</div><div class="status-metric">Uptime 99.99%</div><div class="status-metric">Incidents 0</div></div><h2>Incidents</h2><div class="status-incident-card"><div>Minor latency</div></div><form><button type="submit">Subscribe</button></form><footer>status.example.com</footer></main></div></div></body></html>`;

  const handleApplyTemplate = async (template: StatusPageTemplate) => {
    setTemplateError(null);
    setTemplateLoadingId(template.id);
    try {
      const response = await fetch(`/status-page-templates/${template.file}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Failed to load template');
      const css = await response.text();
      setFormData(prev => ({ ...prev, customCss: css }));
      setSelectedTemplateId(template.id);
      setTemplateError(null);
      setTemplateAppliedNotice(
        `Template applied: ${template.name}. Unsaved changes — press Save to publish.`
      );
    } catch {
      setTemplateError('Failed to load template. Please try again.');
    } finally {
      setTemplateLoadingId(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadTemplates = async () => {
      for (const template of visibleTemplates) {
        if (templateCssMap[template.id] || templateFetchRef.current.has(template.id)) continue;
        templateFetchRef.current.add(template.id);
        try {
          const response = await fetch(`/status-page-templates/${template.file}`, {
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('Template preview fetch failed');
          const css = await response.text();
          if (!cancelled) setTemplateCssMap(prev => ({ ...prev, [template.id]: css }));
        } catch {
          // Legacy preview failures are ignored; this section is no longer navigable.
        } finally {
          templateFetchRef.current.delete(template.id);
        }
      }
    };
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [visibleTemplates, templateCssMap]);

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
    if (formData.customDomain && formData.customDomain.trim()) return formData.customDomain.trim();
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
    <form onSubmit={handleSubmit}>
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
                  className={`status-page-config-tab ${isActive ? 'is-active' : ''}`}
                >
                  {item.icon && <span className="status-page-config-tab-icon">{item.icon}</span>}
                  <span>{item.label}</span>
                  {item.badge ? (
                    <Badge
                      variant={isActive ? 'default' : 'neutral'}
                      size="xs"
                      className={`ml-1 px-1.5 py-0 text-[10px] font-bold ${
                        isActive
                          ? 'bg-primary-foreground text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
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

        <div
          className="status-page-config-body"
          style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
        >
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
            <div
              className="status-page-config-settings-scroll"
              style={{ flex: 1, overflowY: 'auto', padding: 'var(--spacing-4)' }}
            >
              <div
                className="status-page-config-settings-inner"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}
              >
                {activeSection === 'general' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}
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
                                setPrivacySettings(prev => ({ ...prev, requireAuth: !checked }))
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
                )}

                {activeSection === 'appearance' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
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
                                    const parent = (e.target as HTMLImageElement).parentElement;
                                    if (parent)
                                      parent.innerHTML =
                                        '<div class="p-2 text-destructive text-xs">Failed to load image.</div>';
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
                              <div className="text-xs font-semibold text-foreground mb-2">
                                Favicon Preview:
                              </div>
                              <div className="p-2 bg-background border border-border/80 rounded-md inline-block">
                                <img
                                  src={formData.faviconUrl}
                                  alt="Favicon preview"
                                  className="w-8 h-8 object-contain"
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
                    </StatusPageSectionCard>

                    <StatusPageSectionCard
                      title="Layout Options"
                      description="Configure maximum page width and header/footer visibility."
                      icon={<Layout className="w-5 h-5 text-primary" />}
                    >
                      <div className="flex flex-col gap-3">
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
                          helperText="Display the top navigation bar with logo and page title."
                        />
                        <Switch
                          checked={formData.showFooter}
                          onChange={checked => setFormData({ ...formData, showFooter: checked })}
                          label="Show Footer"
                          helperText="Display the footer with support links, API links, and copyright."
                        />
                      </div>
                    </StatusPageSectionCard>
                  </div>
                )}

                {activeSection === 'design' && (
                  <StatusPageDesignSection
                    themeId={formData.themeId}
                    density={formData.themeDensity}
                    customCss={formData.customCss}
                    onThemeChange={themeId => setFormData(prev => ({ ...prev, themeId }))}
                    onDensityChange={themeDensity =>
                      setFormData(prev => ({ ...prev, themeDensity }))
                    }
                    onCustomCssChange={customCss => setFormData(prev => ({ ...prev, customCss }))}
                  />
                )}

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
                    hasSelectedRegions={hasSelectedRegions}
                  />
                )}

                {activeSection === 'privacy' && (
                  <StatusPagePrivacySettings
                    settings={privacySettings}
                    onChange={settings => setPrivacySettings(settings)}
                  />
                )}

                {activeSection === 'content' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <StatusPageSectionCard
                      title="Display Options"
                      description="Toggle which sections and metrics are shown to visitors on your status page."
                      icon={<Sliders className="w-5 h-5 text-primary" />}
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg border border-border/70 bg-card">
                          <Switch
                            checked={formData.showServices}
                            onChange={checked =>
                              setFormData({ ...formData, showServices: checked })
                            }
                            label="Show Services"
                            helperText="Display service status list"
                          />
                        </div>
                        <div className="p-3 rounded-lg border border-border/70 bg-card">
                          <Switch
                            checked={formData.showIncidents}
                            onChange={checked =>
                              setFormData({ ...formData, showIncidents: checked })
                            }
                            label="Show Incidents"
                            helperText="Display incidents section and timeline"
                          />
                        </div>
                        <div className="p-3 rounded-lg border border-border/70 bg-card">
                          <Switch
                            checked={formData.showMetrics}
                            onChange={checked => setFormData({ ...formData, showMetrics: checked })}
                            label="Show Uptime & Availability"
                            helperText="Display service uptime metrics and history"
                          />
                        </div>
                        <div className="p-3 rounded-lg border border-border/70 bg-card">
                          <Switch
                            checked={formData.showSubscribe}
                            onChange={checked =>
                              setFormData({ ...formData, showSubscribe: checked })
                            }
                            label="Show Subscribe to Updates"
                            helperText="Display email subscription section"
                          />
                        </div>
                        <div className="p-3 rounded-lg border border-border/70 bg-card">
                          <Switch
                            checked={formData.showChangelog}
                            onChange={checked =>
                              setFormData({ ...formData, showChangelog: checked })
                            }
                            label="Show Changelog"
                            helperText="Display recent update announcements"
                          />
                        </div>
                        <div className="p-3 rounded-lg border border-border/70 bg-card">
                          <Switch
                            checked={formData.showRegionHeatmap}
                            onChange={checked =>
                              setFormData({ ...formData, showRegionHeatmap: checked })
                            }
                            label="Show Region Heatmap"
                            helperText="Display a compact region impact grid"
                            disabled={privacySettings.showServiceRegions === false}
                          />
                        </div>
                        <div className="p-3 rounded-lg border border-border/70 bg-card md:col-span-2">
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
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <FormField
                            type="input"
                            label="Excellent Threshold (%)"
                            value={String(formData.uptimeExcellentThreshold)}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0 && val <= 100)
                                setFormData({ ...formData, uptimeExcellentThreshold: val });
                            }}
                          />
                          <FormField
                            type="input"
                            label="Good Threshold (%)"
                            value={String(formData.uptimeGoodThreshold)}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0 && val <= 100)
                                setFormData({ ...formData, uptimeGoodThreshold: val });
                            }}
                          />
                        </div>
                      )}
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
                        />
                        <FormField
                          type="textarea"
                          label="Meta Description"
                          rows={2}
                          value={formData.metaDescription}
                          onChange={e =>
                            setFormData({ ...formData, metaDescription: e.target.value })
                          }
                        />
                      </div>
                    </StatusPageSectionCard>
                  </div>
                )}

                {activeSection === 'announcements' && (
                  <StatusPageAnnouncementManager
                    statusPageId={statusPage.id}
                    announcements={announcements}
                    setAnnouncements={setAnnouncements}
                    allServices={announcementServiceOptions}
                    browserTimeZone={browserTimeZone}
                  />
                )}

                {activeSection === 'integrations' && (
                  <StatusPageWebhooksSettings statusPageId={statusPage.id} />
                )}

                {activeSection === 'subscribers' && (
                  <StatusPageSectionCard
                    title="Subscribers"
                    description="Manage your subscriber audience, search emails, view verification status, and perform bulk unsubscription."
                    icon={<Users className="w-5 h-5 text-primary" />}
                  >
                    <StatusPageSubscribers statusPageId={statusPage.id} />
                  </StatusPageSectionCard>
                )}

                {activeSection === 'email-delivery' && (
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
                )}

                {activeSection === 'advanced' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <StatusPageSectionCard
                      title="Live Updates & Feeds"
                      description="Configure client-side polling intervals and public RSS/JSON feed discovery."
                      icon={<RefreshCw className="w-5 h-5 text-primary" />}
                    >
                      <div className="flex flex-col gap-4">
                        <Switch
                          checked={formData.autoRefresh}
                          onChange={checked => setFormData({ ...formData, autoRefresh: checked })}
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
                          />
                        )}
                        <Switch
                          checked={formData.showRssLink}
                          onChange={checked => setFormData({ ...formData, showRssLink: checked })}
                          label="Show RSS Feed Link"
                          helperText="Display link to RSS feed in footer"
                        />
                        <Switch
                          checked={formData.showApiLink}
                          onChange={checked => setFormData({ ...formData, showApiLink: checked })}
                          label="Show JSON API Link"
                          helperText="Display link to JSON API in footer"
                        />
                      </div>
                    </StatusPageSectionCard>

                    <StatusPageSectionCard
                      title="Status API Access & Security"
                      description="Token authentication and rate limiting for JSON and RSS endpoints."
                      icon={<Key className="w-5 h-5 text-primary" />}
                    >
                      <div className="flex flex-col gap-4">
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
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <FormField
                              type="input"
                              label="Max requests"
                              value={String(formData.statusApiRateLimitMax)}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                const val = parseInt(e.target.value, 10);
                                if (!Number.isNaN(val))
                                  setFormData({ ...formData, statusApiRateLimitMax: val });
                              }}
                            />
                            <FormField
                              type="input"
                              label="Window (seconds)"
                              value={String(formData.statusApiRateLimitWindowSec)}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                const val = parseInt(e.target.value, 10);
                                if (!Number.isNaN(val))
                                  setFormData({ ...formData, statusApiRateLimitWindowSec: val });
                              }}
                            />
                          </div>
                        )}
                        <div className="border-t border-border pt-4">
                          <div className="flex flex-wrap items-end gap-3">
                            <FormField
                              type="input"
                              label="Token name"
                              value={apiTokenName}
                              onChange={e => setApiTokenName(e.target.value)}
                              placeholder="e.g. External status monitor"
                            />
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
                            <InlineNotice tone="error" className="mt-3">
                              {apiTokenError}
                            </InlineNotice>
                          )}
                          {apiTokenValue && (
                            <InlineNotice tone="neutral" className="mt-3">
                              Copy this token now: <code>{apiTokenValue}</code>
                            </InlineNotice>
                          )}
                          <div className="mt-4 flex flex-col gap-2">
                            {apiTokens.map(token => (
                              <div
                                key={token.id}
                                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                              >
                                <div>
                                  <div className="font-semibold">{token.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    Prefix: {token.prefix} · Created{' '}
                                    {formatDateTime(token.createdAt, browserTimeZone, {
                                      format: 'date',
                                    })}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => handleRevokeApiToken(token.id)}
                                  disabled={Boolean(token.revokedAt)}
                                >
                                  {token.revokedAt ? 'Revoked' : 'Revoke'}
                                </Button>
                              </div>
                            ))}
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
                    </StatusPageSectionCard>

                    <DangerZoneCard
                      title="Danger Zone"
                      description="Irreversible actions for this status page."
                    />
                  </div>
                )}

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
            </div>

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

          {showPreview && previewData && (
            <div
              className="status-page-config-preview"
              style={{
                flex: '0 0 48%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minWidth: 0,
                borderLeft: '1px solid hsl(var(--border))',
                background: 'hsl(var(--card))',
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
    </form>
  );
}
