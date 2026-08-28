'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Card, Button, FormField, Switch, Checkbox } from '@/components/ui';
import StatusPageLivePreview from '@/components/status-page/StatusPageLivePreview';
import { useRouter } from 'next/navigation';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import _StatusPageHeader from '@/components/status-page/StatusPageHeader';
import _StatusPageServices from '@/components/status-page/StatusPageServices';
import _StatusPageIncidents from '@/components/status-page/StatusPageIncidents';
import _StatusPageAnnouncements from '@/components/status-page/StatusPageAnnouncements';
import StatusPagePrivacySettings, {
  type PrivacySettings,
} from '@/components/status-page/StatusPagePrivacySettings';
import StatusPageWebhooksSettings from '@/components/status-page/StatusPageWebhooksSettings';
import StatusPageSubscribers from '@/components/status-page/StatusPageSubscribers';
import StatusPageEmailConfig from '@/components/status-page/StatusPageEmailConfig';
import { Badge } from '@/components/ui/shadcn/badge';

type StatusPageConfigProps = {
  statusPage: {
    id: string;
    name: string;
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
    branding?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    requireAuth?: boolean;
    privacyMode?: string;
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

const STATUS_PAGE_TEMPLATES: StatusPageTemplate[] = [
  {
    id: 'aurora-bright',
    name: 'Aurora Bright',
    file: 'aurora-bright.css',
    colors: ['#ff6a00', '#00c2ff', '#7c3aed'],
    category: 'colorful',
  },
  {
    id: 'redline',
    name: 'Redline',
    file: 'redline.css',
    colors: ['#ef4444', '#b91c1c', '#fee2e2'],
    category: 'colorful',
  },
  {
    id: 'ocean-glass',
    name: 'Ocean Glass',
    file: 'ocean-glass.css',
    colors: ['#0ea5e9', '#22d3ee', '#e0f2fe'],
    category: 'colorful',
  },
  {
    id: 'sunset-bloom',
    name: 'Sunset Bloom',
    file: 'sunset-bloom.css',
    colors: ['#fb7185', '#f59e0b', '#ec4899'],
    category: 'pastel',
  },
  {
    id: 'midnight-neon',
    name: 'Midnight Neon',
    file: 'midnight-neon.css',
    colors: ['#22d3ee', '#a855f7', '#f472b6'],
    category: 'dark',
  },
  {
    id: 'minimal-warm',
    name: 'Minimal Warm',
    file: 'minimal-warm.css',
    colors: ['#f97316', '#fb923c', '#fff7ed'],
    category: 'minimal',
  },
  {
    id: 'emerald-dawn',
    name: 'Emerald Dawn',
    file: 'emerald-dawn.css',
    colors: ['#10b981', '#84cc16', '#ecfdf5'],
    category: 'colorful',
  },
  {
    id: 'royal-blueprint',
    name: 'Royal Blueprint',
    file: 'royal-blueprint.css',
    colors: ['#2563eb', '#4338ca', '#eef2ff'],
    category: 'colorful',
  },
  {
    id: 'citrus-pop',
    name: 'Citrus Pop',
    file: 'citrus-pop.css',
    colors: ['#f97316', '#eab308', '#fef9c3'],
    category: 'colorful',
  },
  {
    id: 'lavender-mist',
    name: 'Lavender Mist',
    file: 'lavender-mist.css',
    colors: ['#a855f7', '#7c3aed', '#faf5ff'],
    category: 'pastel',
  },
  {
    id: 'graphite-gold',
    name: 'Graphite Gold',
    file: 'graphite-gold.css',
    colors: ['#111827', '#f59e0b', '#f9fafb'],
    category: 'minimal',
  },
  {
    id: 'forest-glow',
    name: 'Forest Glow',
    file: 'forest-glow.css',
    colors: ['#166534', '#22c55e', '#dcfce7'],
    category: 'colorful',
  },
  {
    id: 'coral-reef',
    name: 'Coral Reef',
    file: 'coral-reef.css',
    colors: ['#f43f5e', '#14b8a6', '#f0fdfa'],
    category: 'colorful',
  },
  {
    id: 'slate-mint',
    name: 'Slate Mint',
    file: 'slate-mint.css',
    colors: ['#334155', '#2dd4bf', '#f8fafc'],
    category: 'minimal',
  },
  {
    id: 'sunlit-sky',
    name: 'Sunlit Sky',
    file: 'sunlit-sky.css',
    colors: ['#facc15', '#38bdf8', '#fefce8'],
    category: 'colorful',
  },
  {
    id: 'magma-pulse',
    name: 'Magma Pulse',
    file: 'magma-pulse.css',
    colors: ['#ef4444', '#f59e0b', '#ffedd5'],
    category: 'colorful',
  },
  {
    id: 'denim-rose',
    name: 'Denim Rose',
    file: 'denim-rose.css',
    colors: ['#1d4ed8', '#fb7185', '#eff6ff'],
    category: 'colorful',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    file: 'glacier.css',
    colors: ['#38bdf8', '#22d3ee', '#ecfeff'],
    category: 'pastel',
  },
  {
    id: 'copper-patina',
    name: 'Copper Patina',
    file: 'copper-patina.css',
    colors: ['#c2410c', '#0f766e', '#f0fdfa'],
    category: 'colorful',
  },
  {
    id: 'sandstorm',
    name: 'Sandstorm',
    file: 'sandstorm.css',
    colors: ['#d97706', '#a3e635', '#fef3c7'],
    category: 'colorful',
  },
  {
    id: 'berry-soda',
    name: 'Berry Soda',
    file: 'berry-soda.css',
    colors: ['#a21caf', '#ec4899', '#fdf4ff'],
    category: 'colorful',
  },
  {
    id: 'monochrome-ink',
    name: 'Monochrome Ink',
    file: 'monochrome-ink.css',
    colors: ['#0f172a', '#334155', '#f3f4f6'],
    category: 'minimal',
  },
  {
    id: 'pastel-garden',
    name: 'Pastel Garden',
    file: 'pastel-garden.css',
    colors: ['#fda4af', '#86efac', '#ecfccb'],
    category: 'pastel',
  },
  {
    id: 'steel-sunset',
    name: 'Steel Sunset',
    file: 'steel-sunset.css',
    colors: ['#475569', '#fb7185', '#f8fafc'],
    category: 'minimal',
  },
  {
    id: 'teal-amber',
    name: 'Teal Amber',
    file: 'teal-amber.css',
    colors: ['#14b8a6', '#f59e0b', '#ecfeff'],
    category: 'colorful',
  },
  {
    id: 'violet-cyan',
    name: 'Violet Cyan',
    file: 'violet-cyan.css',
    colors: ['#8b5cf6', '#22d3ee', '#f5f3ff'],
    category: 'colorful',
  },
  {
    id: 'ruby-navy',
    name: 'Ruby Navy',
    file: 'ruby-navy.css',
    colors: ['#e11d48', '#1e3a8a', '#eff6ff'],
    category: 'colorful',
  },
  {
    id: 'charcoal-lime',
    name: 'Charcoal Lime',
    file: 'charcoal-lime.css',
    colors: ['#111827', '#84cc16', '#f7fee7'],
    category: 'minimal',
  },
  {
    id: 'blush-cream',
    name: 'Blush Cream',
    file: 'blush-cream.css',
    colors: ['#f472b6', '#fde68a', '#fdf2f8'],
    category: 'pastel',
  },
  {
    id: 'neon-lime',
    name: 'Neon Lime',
    file: 'neon-lime.css',
    colors: ['#a3e635', '#22d3ee', '#ecfeff'],
    category: 'colorful',
  },
  {
    id: 'coffee-cream',
    name: 'Coffee Cream',
    file: 'coffee-cream.css',
    colors: ['#7c2d12', '#f59e0b', '#fef9c3'],
    category: 'minimal',
  },
  {
    id: 'arctic-night',
    name: 'Arctic Night',
    file: 'arctic-night.css',
    colors: ['#38bdf8', '#0f172a', '#111827'],
    category: 'dark',
  },
  {
    id: 'retro-pop',
    name: 'Retro Pop',
    file: 'retro-pop.css',
    colors: ['#f97316', '#14b8a6', '#fff7ed'],
    category: 'colorful',
  },
  {
    id: 'mint-lilac',
    name: 'Mint Lilac',
    file: 'mint-lilac.css',
    colors: ['#34d399', '#c084fc', '#faf5ff'],
    category: 'pastel',
  },
  {
    id: 'ocean-sunset',
    name: 'Ocean Sunset',
    file: 'ocean-sunset.css',
    colors: ['#0ea5e9', '#f97316', '#fff7ed'],
    category: 'colorful',
  },
  {
    id: 'amber-slate',
    name: 'Amber Slate',
    file: 'amber-slate.css',
    colors: ['#f59e0b', '#475569', '#fef3c7'],
    category: 'colorful',
  },
  {
    id: 'pastel-sky',
    name: 'Pastel Sky',
    file: 'pastel-sky.css',
    colors: ['#93c5fd', '#fbcfe8', '#eff6ff'],
    category: 'pastel',
  },
  {
    id: 'jade-ink',
    name: 'Jade Ink',
    file: 'jade-ink.css',
    colors: ['#22c55e', '#15803d', '#f0fdf4'],
    category: 'colorful',
  },
  {
    id: 'electric-blue',
    name: 'Electric Blue',
    file: 'electric-blue.css',
    colors: ['#3b82f6', '#06b6d4', '#ecfeff'],
    category: 'colorful',
  },
  {
    id: 'graphite-teal',
    name: 'Graphite Teal',
    file: 'graphite-teal.css',
    colors: ['#1f2937', '#14b8a6', '#f1f5f9'],
    category: 'minimal',
  },
  {
    id: 'desert-night',
    name: 'Desert Night',
    file: 'desert-night.css',
    colors: ['#f59e0b', '#0f172a', '#1e293b'],
    category: 'dark',
  },
  {
    id: 'tangerine-aqua',
    name: 'Tangerine Aqua',
    file: 'tangerine-aqua.css',
    colors: ['#f97316', '#22d3ee', '#ecfeff'],
    category: 'colorful',
  },
  {
    id: 'corporate-blue',
    name: 'Corporate Blue',
    file: 'corporate-blue.css',
    colors: ['#1d4ed8', '#0f172a', '#f8fafc'],
    category: 'professional',
  },
  {
    id: 'enterprise-gray',
    name: 'Enterprise Gray',
    file: 'enterprise-gray.css',
    colors: ['#111827', '#374151', '#f3f4f6'],
    category: 'professional',
  },
  {
    id: 'slate-executive',
    name: 'Slate Executive',
    file: 'slate-executive.css',
    colors: ['#334155', '#3b82f6', '#f1f5f9'],
    category: 'professional',
  },
  {
    id: 'clean-white',
    name: 'Clean White',
    file: 'clean-white.css',
    colors: ['#2563eb', '#111827', '#ffffff'],
    category: 'professional',
  },
  {
    id: 'navy-silver',
    name: 'Navy Silver',
    file: 'navy-silver.css',
    colors: ['#1e3a8a', '#1d4ed8', '#f1f5f9'],
    category: 'professional',
  },
  {
    id: 'indigo-mint-pro',
    name: 'Indigo Mint',
    file: 'indigo-mint-pro.css',
    colors: ['#4f46e5', '#10b981', '#f8fafc'],
    category: 'professional',
  },
  {
    id: 'boardroom-slate',
    name: 'Boardroom Slate',
    file: 'boardroom-slate.css',
    colors: ['#0f172a', '#334155', '#e2e8f0'],
    category: 'professional',
  },
  {
    id: 'capital-ivory',
    name: 'Capital Ivory',
    file: 'capital-ivory.css',
    colors: ['#111827', '#6b7280', '#f9fafb'],
    category: 'professional',
  },
  {
    id: 'steel-harbor',
    name: 'Steel Harbor',
    file: 'steel-harbor.css',
    colors: ['#1f2937', '#475569', '#e5e7eb'],
    category: 'professional',
  },
  {
    id: 'summit-teal',
    name: 'Summit Teal',
    file: 'summit-teal.css',
    colors: ['#0f766e', '#14b8a6', '#e6f7f5'],
    category: 'professional',
  },
  {
    id: 'harbor-navy',
    name: 'Harbor Navy',
    file: 'harbor-navy.css',
    colors: ['#0b1f3a', '#1d4ed8', '#e2e8f0'],
    category: 'professional',
  },
  {
    id: 'ironwood',
    name: 'Ironwood',
    file: 'ironwood.css',
    colors: ['#3f2d20', '#6b4f3b', '#efe7df'],
    category: 'professional',
  },
  {
    id: 'deep-aurora',
    name: 'Deep Aurora',
    file: 'deep-aurora.css',
    colors: ['#0f172a', '#0ea5e9', '#e0f2fe'],
    category: 'professional',
  },
  {
    id: 'midnight-cobalt',
    name: 'Midnight Cobalt',
    file: 'midnight-cobalt.css',
    colors: ['#0b1020', '#1e3a8a', '#0ea5e9'],
    category: 'dark',
  },
  {
    id: 'obsidian-ember',
    name: 'Obsidian Ember',
    file: 'obsidian-ember.css',
    colors: ['#111827', '#b45309', '#f97316'],
    category: 'dark',
  },
  {
    id: 'evergreen-night',
    name: 'Evergreen Night',
    file: 'evergreen-night.css',
    colors: ['#0b1f1a', '#065f46', '#10b981'],
    category: 'dark',
  },
  {
    id: 'storm-plum',
    name: 'Storm Plum',
    file: 'storm-plum.css',
    colors: ['#1b1025', '#6d28d9', '#c4b5fd'],
    category: 'dark',
  },
  {
    id: 'smoked-olive',
    name: 'Smoked Olive',
    file: 'smoked-olive.css',
    colors: ['#1b1f16', '#4d5c2d', '#e7ecd8'],
    category: 'minimal',
  },
  {
    id: 'quiet-charcoal',
    name: 'Quiet Charcoal',
    file: 'quiet-charcoal.css',
    colors: ['#111827', '#334155', '#f1f5f9'],
    category: 'minimal',
  },
  {
    id: 'clear-contrast',
    name: 'Clear Contrast',
    file: 'clear-contrast.css',
    colors: ['#0b1f3a', '#f59e0b', '#f8fafc'],
    category: 'professional',
  },
  {
    id: 'gov-heritage',
    name: 'Gov Heritage',
    file: 'gov-heritage.css',
    colors: ['#12344d', '#2f855a', '#e2e8f0'],
    category: 'professional',
  },
  {
    id: 'health-azure',
    name: 'Health Azure',
    file: 'health-azure.css',
    colors: ['#0ea5e9', '#0f766e', '#e0f2fe'],
    category: 'professional',
  },
  {
    id: 'finance-graphite',
    name: 'Finance Graphite',
    file: 'finance-graphite.css',
    colors: ['#1f2937', '#0f172a', '#f3f4f6'],
    category: 'professional',
  },
  {
    id: 'minimal-sandstone',
    name: 'Minimal Sandstone',
    file: 'minimal-sandstone.css',
    colors: ['#7c5c42', '#a67c52', '#f7efe6'],
    category: 'minimal',
  },
  {
    id: 'minimal-steel',
    name: 'Minimal Steel',
    file: 'minimal-steel.css',
    colors: ['#334155', '#64748b', '#e2e8f0'],
    category: 'minimal',
  },
  {
    id: 'dark-flat-onyx',
    name: 'Dark Flat Onyx',
    file: 'dark-flat-onyx.css',
    colors: ['#0f172a', '#475569', '#94a3b8'],
    category: 'dark',
  },
  {
    id: 'dark-nordic',
    name: 'Dark Nordic',
    file: 'dark-nordic.css',
    colors: ['#0b1321', '#2563eb', '#e0e7ff'],
    category: 'dark',
  },
  {
    id: 'colorful-saffron',
    name: 'Colorful Saffron',
    file: 'colorful-saffron.css',
    colors: ['#f59e0b', '#ef4444', '#fef3c7'],
    category: 'colorful',
  },
  {
    id: 'colorful-pacific',
    name: 'Colorful Pacific',
    file: 'colorful-pacific.css',
    colors: ['#0ea5e9', '#14b8a6', '#ecfeff'],
    category: 'colorful',
  },
  {
    id: 'pastel-lilac',
    name: 'Pastel Lilac',
    file: 'pastel-lilac.css',
    colors: ['#c4b5fd', '#f5d0fe', '#f5f3ff'],
    category: 'pastel',
  },
  {
    id: 'pastel-seafoam',
    name: 'Pastel Seafoam',
    file: 'pastel-seafoam.css',
    colors: ['#99f6e4', '#bae6fd', '#ecfeff'],
    category: 'pastel',
  },
  {
    id: 'dark-crimson',
    name: 'Dark Crimson',
    file: 'dark-crimson.css',
    colors: ['#7f1d1d', '#b91c1c', '#fecaca'],
    category: 'dark',
  },
  {
    id: 'ember-rose',
    name: 'Ember Rose',
    file: 'ember-rose.css',
    colors: ['#9f2a2a', '#d14343', '#f6d2d2'],
    category: 'minimal',
  },
];

export default function StatusPageConfig({ statusPage, allServices }: StatusPageConfigProps) {
  const { browserTimeZone } = useTimezone();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('general');
  const [showPreview, setShowPreview] = useState(false);
  const [announcementError, setAnnouncementError] = useState<string | null>(null);
  const [isAnnouncementPending, startAnnouncementTransition] = useTransition();
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [templateLoadingId, setTemplateLoadingId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState<'all' | TemplateCategory>('all');
  const [templateCssMap, setTemplateCssMap] = useState<Record<string, string>>({});
  const templateFetchRef = useRef<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Parse branding JSON
  const branding =
    statusPage.branding && typeof statusPage.branding === 'object' ? statusPage.branding : {};

  const [formData, setFormData] = useState({
    name: statusPage.name,
    organizationName: statusPage.organizationName || '',
    subdomain: statusPage.subdomain || '',
    customDomain: statusPage.customDomain || '',
    enabled: statusPage.enabled,
    requireAuth: statusPage.requireAuth ?? false,
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
    logoUrl: branding.logoUrl || '/logo.svg',
    faviconUrl: branding.faviconUrl || '',
    primaryColor: branding.primaryColor || '#667eea',
    backgroundColor: branding.backgroundColor || '#ffffff',
    textColor: branding.textColor || '#111827',
    // Custom CSS
    customCss: branding.customCss || '',
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

  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    message: '',
    type: 'INFO',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    isActive: true,
    notifySubscribers: true,
    affectedServiceIds: [] as string[],
  });
  const [announcements, setAnnouncements] = useState(statusPage.announcements);
  const [apiTokens, setApiTokens] = useState(statusPage.apiTokens ?? []);
  const [apiTokenName, setApiTokenName] = useState('');
  const [apiTokenValue, setApiTokenValue] = useState<string | null>(null);
  const [apiTokenError, setApiTokenError] = useState<string | null>(null);
  const [apiTokenPending, startApiTokenTransition] = useTransition();

  type SidebarItem = {
    id: string;
    label: string;
    icon?: string;
    badge?: number;
    link?: string;
  };

  // Sidebar items - defined after announcements state
  const sidebarItems: SidebarItem[] = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'appearance', label: 'Appearance', icon: '🎨' },
    { id: 'services', label: 'Services', icon: '🔧' },
    { id: 'privacy', label: 'Privacy & Data', icon: '🔒' },
    { id: 'content', label: 'Content', icon: '📝' },
    { id: 'announcements', label: 'Announcements', icon: '📢', badge: announcements.length },
    { id: 'integrations', label: 'Integrations', icon: '🔌' },
    { id: 'subscribers', label: 'Subscribers', icon: '👥' },
    { id: 'customization', label: 'Custom CSS', icon: '🖌️' },
    { id: 'advanced', label: 'Advanced', icon: '⚡' },
  ];

  const [selectedServices, setSelectedServices] = useState<Set<string>>(
    new Set(statusPage.services.map(s => s.serviceId))
  );

  const [serviceConfigs, setServiceConfigs] = useState<
    Record<string, { displayName: string; order: number; showOnPage: boolean }>
  >(
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
    )
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
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>({
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
    maxIncidentsToShow: statusPage.maxIncidentsToShow || 50,
    incidentHistoryDays: statusPage.incidentHistoryDays || 90,
    allowedCustomFields: statusPage.allowedCustomFields || [],
    dataRetentionDays: statusPage.dataRetentionDays || null,
    requireAuth: statusPage.requireAuth || false,
    authProvider: statusPage.authProvider || null,
  });

  const selectedServiceIds = Array.from(selectedServices);
  const announcementServiceOptions = allServices.filter(service =>
    selectedServices.has(service.id)
  );
  const hasSelectedRegions = allServices.some(
    service =>
      selectedServices.has(service.id) &&
      Boolean(service.region && service.region.trim().length > 0)
  );
  const previewServiceIds =
    selectedServiceIds.length > 0 ? selectedServiceIds : allServices.map(service => service.id);
  const previewServices = allServices
    .filter(service => previewServiceIds.includes(service.id))
    .map(service => ({
      id: service.id,
      name: service.name,
      status: 'OPERATIONAL',
      _count: { incidents: 0 },
    }));

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
    acc[service.id] = 100;
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
    setSuccessMessage(null);

    startTransition(async () => {
      try {
        const brandingData = {
          logoUrl: formData.logoUrl,
          faviconUrl: formData.faviconUrl,
          primaryColor: formData.primaryColor,
          backgroundColor: formData.backgroundColor,
          textColor: formData.textColor,
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

        const response = await fetch('/api/settings/status-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
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
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save status page settings');
        }

        setSuccessMessage('Settings saved successfully!');
        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(null), 3000);
        router.refresh();
      } catch (err: any) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setError(getUserFacingErrorMessage(err) || 'Failed to save settings');
      }
    });
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

  const handleAnnouncementCreate = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    setAnnouncementError(null);

    const title = announcementForm.title.trim();
    const message = announcementForm.message.trim();
    if (!title || !message) {
      setAnnouncementError('Title and message are required.');
      return;
    }

    startAnnouncementTransition(async () => {
      try {
        const response = await fetch('/api/settings/status-page/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            statusPageId: statusPage.id,
            title,
            message,
            type: announcementForm.type,
            startDate: announcementForm.startDate,
            endDate: announcementForm.endDate || null,
            isActive: announcementForm.isActive,
            notifySubscribers: announcementForm.notifySubscribers,
            affectedServiceIds:
              announcementForm.affectedServiceIds.length > 0
                ? announcementForm.affectedServiceIds
                : null,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create announcement');
        }

        const data = await response.json();
        if (data?.announcement) {
          setAnnouncements(current => {
            const next = [data.announcement, ...current];
            return next.sort(
              (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
            );
          });
        }

        setAnnouncementForm({
          title: '',
          message: '',
          type: 'INFO',
          startDate: new Date().toISOString().slice(0, 10),
          endDate: '',
          isActive: true,
          notifySubscribers: true,
          affectedServiceIds: [],
        });
      } catch (err: any) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setAnnouncementError(getUserFacingErrorMessage(err) || 'Failed to create announcement');
      }
    });
  };

  const handleAnnouncementDelete = (id: string) => {
    setAnnouncementError(null);

    startAnnouncementTransition(async () => {
      try {
        const response = await fetch('/api/settings/status-page/announcements', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to delete announcement');
        }

        setAnnouncements(current => current.filter(announcement => announcement.id !== id));
      } catch (err: any) {
        const { getUserFacingErrorMessage } = await import('@/lib/user-facing-error');
        setAnnouncementError(getUserFacingErrorMessage(err) || 'Failed to delete announcement');
      }
    });
  };

  const handleAnnouncementServiceToggle = (serviceId: string) => {
    setAnnouncementForm(prev => {
      const next = new Set(prev.affectedServiceIds);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return { ...prev, affectedServiceIds: Array.from(next) };
    });
  };

  const handleAnnouncementServiceSelectAll = () => {
    setAnnouncementForm(prev => ({
      ...prev,
      affectedServiceIds: announcementServiceOptions.map(service => service.id),
    }));
  };

  const handleAnnouncementServiceClear = () => {
    setAnnouncementForm(prev => ({ ...prev, affectedServiceIds: [] }));
  };

  const handleCreateApiToken = (e: React.FormEvent) => {
    e.preventDefault();
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
          body: JSON.stringify({ id }),
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
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; }
      .preview-root { min-height: 100%; }
      .status-page-container { min-height: 100%; padding: 10px; }
      .status-page-header { padding: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .status-page-header h1 { font-size: 13px; margin: 0; }
      .status-page-header p { margin: 4px 0 0 0; font-size: 9px; }
      .status-page-header a { font-size: 9px; text-decoration: none; padding: 4px 8px; border-radius: 999px; }
      main { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
      h2 { font-size: 10px; margin: 0; text-transform: uppercase; letter-spacing: 0.06em; }
      .status-service-card, .status-incident-card { padding: 8px; border-radius: 10px; }
      .status-service-card div, .status-incident-card div { font-size: 10px; font-weight: 600; }
      .status-announce-card { padding: 8px; border-radius: 10px; border: 1px solid rgba(15, 23, 42, 0.08); }
      .status-announce-card div { font-size: 10px; font-weight: 600; }
      .status-metric-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .status-metric { padding: 6px; border-radius: 8px; border: 1px solid rgba(15, 23, 42, 0.08); font-size: 9px; text-align: center; }
      .status-legend { display: flex; gap: 6px; font-size: 9px; }
      .status-dot { width: 6px; height: 6px; border-radius: 999px; display: inline-block; margin-right: 4px; }
      footer { margin-top: 6px; font-size: 9px; text-align: center; }
      form { margin-top: 4px; }
      form button { width: 100%; padding: 6px; font-size: 9px; border-radius: 10px; }
    </style>
    <style>${css}</style>
  </head>
  <body>
    <div class="preview-root">
      <div class="status-page-container">
        <header class="status-page-header">
          <div>
            <h1>${name}</h1>
            <p>All systems operational</p>
          </div>
          <a href="#">Contact</a>
        </header>
        <main>
          <h2>Announcements</h2>
          <div class="status-announce-card"><div>Planned maintenance</div></div>
          <h2>Services</h2>
          <div class="status-service-card"><div>API Gateway</div></div>
          <div class="status-legend">
            <span><span class="status-dot" style="background:#22c55e;"></span>Operational</span>
            <span><span class="status-dot" style="background:#f59e0b;"></span>Degraded</span>
            <span><span class="status-dot" style="background:#ef4444;"></span>Outage</span>
          </div>
          <h2>Metrics</h2>
          <div class="status-metric-row">
            <div class="status-metric">Latency 120ms</div>
            <div class="status-metric">Uptime 99.99%</div>
            <div class="status-metric">Incidents 0</div>
          </div>
          <h2>Incidents</h2>
          <div class="status-incident-card"><div>Minor latency</div></div>
          <form><button type="submit">Subscribe</button></form>
          <footer>status.example.com</footer>
        </main>
      </div>
    </div>
  </body>
</html>
`;

  const handleApplyTemplate = async (template: StatusPageTemplate) => {
    setTemplateError(null);
    setTemplateLoadingId(template.id);
    try {
      const response = await fetch(`/status-page-templates/${template.file}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to load template');
      }
      const css = await response.text();
      setFormData(prev => ({ ...prev, customCss: css }));
      setSelectedTemplateId(template.id);
      setSuccessMessage(`Template loaded: ${template.name}. Remember to save settings.`);
      setTimeout(() => setSuccessMessage(null), 3000);
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
        if (templateCssMap[template.id] || templateFetchRef.current.has(template.id)) {
          continue;
        }
        templateFetchRef.current.add(template.id);
        try {
          const response = await fetch(`/status-page-templates/${template.file}`, {
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error('Template preview fetch failed');
          }
          const css = await response.text();
          if (!cancelled) {
            setTemplateCssMap(prev => ({ ...prev, [template.id]: css }));
          }
        } catch {
          // Ignore preview failures; button still loads full CSS on demand.
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
    maxIncidentsToShow: privacySettings.maxIncidentsToShow || 50,
    incidentHistoryDays: privacySettings.incidentHistoryDays || 90,
    allowedCustomFields: privacySettings.allowedCustomFields || [],
    dataRetentionDays: privacySettings.dataRetentionDays || null,
    requireAuth: privacySettings.requireAuth !== false,
    authProvider: privacySettings.authProvider || null,
  };

  const previewData = {
    statusPage: {
      name: formData.name,
      contactEmail: formData.contactEmail || null,
      contactUrl: formData.contactUrl || null,
    },
    branding: previewBranding,
    services: previewServices,
    statusPageServices: previewStatusPageServices,
    announcements: previewAnnouncements.map((a: any) => ({
      ...a,
      startDate: a.startDate.toISOString(),
      endDate: a.endDate ? a.endDate.toISOString() : null,
      affectedServices: buildAnnouncementAffectedServices(a.affectedServiceIds),
    })),
    uptime90: previewUptime90,
    incidents: [],
    showServices: formData.showServices,
    showIncidents: formData.showIncidents,
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
  };

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
        {/* Top Navigation */}
        <div className="status-page-config-tabs">
          <div className="status-page-config-tabs-list">
            {sidebarItems.map(item => {
              const ItemComponent = item.link ? 'a' : 'button';
              const isActive = activeSection === item.id;
              return (
                <ItemComponent
                  key={item.id}
                  type={!item.link ? 'button' : undefined}
                  href={item.link}
                  onClick={() => !item.link && setActiveSection(item.id)}
                  className={`status-page-config-tab ${isActive ? 'is-active' : ''}`}
                >
                  {item.icon && <span className="status-page-config-tab-icon">{item.icon}</span>}
                  {item.label}
                  {item.badge ? (
                    <Badge variant={isActive ? 'info' : 'neutral'} size="xs" className="ml-auto">
                      {item.badge}
                    </Badge>
                  ) : null}
                </ItemComponent>
              );
            })}
          </div>
          <div className="status-page-config-tabs-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowPreview(!showPreview)}
              className="status-page-config-preview-toggle"
            >
              {showPreview ? 'Hide Preview' : 'Show Preview'}
            </Button>
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
              flex: showPreview ? '0 0 58%' : '1',
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
                padding: 'var(--spacing-6)',
              }}
            >
              <div
                className="status-page-config-settings-inner"
                style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
              >
                {/* General Settings */}
                {activeSection === 'general' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card hover className="status-page-config-card">
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2 className="status-page-config-card-title">Basic Settings</h2>
                        <p className="status-page-config-card-desc">
                          Define the identity and presentation name displayed on your public status
                          page.
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-4)',
                          }}
                        >
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
                            helperText="Used in email headers (e.g., 'OpsKnight'). Overrides Status Page Name if set."
                            placeholder="e.g. OpsKnight"
                          />
                        </div>
                      </div>
                    </Card>

                    <Card hover className="status-page-config-card">
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2 className="status-page-config-card-title">Access & Visibility</h2>
                        <p className="status-page-config-card-desc">
                          Control who can access the status page and when it is publicly visible.
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-4)',
                          }}
                        >
                          <Switch
                            checked={formData.enabled}
                            onChange={checked =>
                              setFormData(prev => ({ ...prev, enabled: checked }))
                            }
                            label="Enable Status Page"
                            helperText="Make the status page accessible to users."
                          />

                          {formData.enabled && (
                            <Switch
                              checked={!formData.requireAuth}
                              onChange={checked =>
                                setFormData(prev => ({ ...prev, requireAuth: !checked }))
                              }
                              label="Public Access"
                              helperText="When enabled, anyone can view the status page without logging in. When disabled, users must log in to view the status page."
                            />
                          )}
                        </div>
                      </div>
                    </Card>

                    <Card hover className="status-page-config-card">
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2 className="status-page-config-card-title">Domain Configuration</h2>
                        <p className="status-page-config-card-desc">
                          Configure subdomains and custom domains to host your status page.
                        </p>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-4)',
                          }}
                        >
                          <FormField
                            type="input"
                            label="Subdomain"
                            value={formData.subdomain}
                            onChange={e => setFormData({ ...formData, subdomain: e.target.value })}
                            placeholder="status"
                            helperText="e.g., status (for status.yourcompany.com). Requires DNS configuration."
                          />

                          <FormField
                            type="input"
                            label="Custom Domain"
                            value={formData.customDomain}
                            onChange={e =>
                              setFormData({ ...formData, customDomain: e.target.value })
                            }
                            placeholder="status.yourcompany.com"
                            helperText="Full custom domain. Requires DNS CNAME record pointing to your status page."
                          />
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Contact Information
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-4)',
                          }}
                        >
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
                            onChange={e => setFormData({ ...formData, contactUrl: e.target.value })}
                            placeholder="https://yourcompany.com/contact"
                            helperText="URL for contact page or support portal"
                          />
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Appearance Settings */}
                {activeSection === 'appearance' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Branding & Logo
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-6)',
                          }}
                        >
                          <div>
                            <FormField
                              type="input"
                              inputType="text"
                              label="Logo URL"
                              value={formData.logoUrl}
                              onChange={e => setFormData({ ...formData, logoUrl: e.target.value })}
                              placeholder="https://yourcompany.com/logo.png"
                              helperText="Full URL or relative path (e.g., /logo.svg). Recommended: 200x50px, PNG or SVG format. The logo will appear in the status page header."
                              required={false}
                            />
                            <div style={{ marginTop: 'var(--spacing-2)' }}>
                              <button
                                type="button"
                                onClick={() => setFormData({ ...formData, logoUrl: '/logo.svg' })}
                                className="status-page-button"
                              >
                                Use default app logo
                              </button>
                            </div>
                            <div style={{ marginTop: 'var(--spacing-3)' }}>
                              <label
                                style={{
                                  display: 'block',
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: '600',
                                  marginBottom: 'var(--spacing-2)',
                                }}
                              >
                                Upload Logo
                              </label>
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                onChange={e => handleLogoUpload(e.target.files?.[0] || null)}
                                style={{
                                  width: '100%',
                                  padding: '0.4rem 0',
                                  fontSize: 'var(--font-size-sm)',
                                }}
                              />
                              <div
                                style={{
                                  fontSize: 'var(--font-size-xs)',
                                  color: 'var(--text-muted)',
                                  marginTop: 'var(--spacing-1)',
                                }}
                              >
                                Uploads are stored as data URLs. Max size 2MB.
                              </div>
                              {logoUploadError && (
                                <div
                                  style={{
                                    color: 'var(--color-error-dark)',
                                    fontSize: 'var(--font-size-xs)',
                                    marginTop: 'var(--spacing-1)',
                                  }}
                                >
                                  {logoUploadError}
                                </div>
                              )}
                            </div>
                            {formData.logoUrl && (
                              <div
                                style={{
                                  marginTop: 'var(--spacing-3)',
                                  padding: 'var(--spacing-4)',
                                  background: '#f9fafb',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 'var(--radius-md)',
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: '600',
                                    marginBottom: 'var(--spacing-2)',
                                    color: '#374151',
                                  }}
                                >
                                  Logo Preview:
                                </div>
                                <div
                                  style={{
                                    padding: 'var(--spacing-3)',
                                    background: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'inline-block',
                                  }}
                                >
                                  <img
                                    src={formData.logoUrl}
                                    alt="Logo preview"
                                    style={{
                                      height: '50px',
                                      maxWidth: '200px',
                                      objectFit: 'contain',
                                    }}
                                    onError={e => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                      const parent = (e.target as HTMLImageElement).parentElement;
                                      if (parent) {
                                        parent.innerHTML =
                                          '<div style="padding: 1rem; color: #ef4444; font-size: 0.875rem;">Failed to load image. Please check the URL.</div>';
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                          <div>
                            <FormField
                              type="input"
                              inputType="url"
                              label="Favicon URL"
                              value={formData.faviconUrl}
                              onChange={e =>
                                setFormData({ ...formData, faviconUrl: e.target.value })
                              }
                              placeholder="https://yourcompany.com/favicon.ico"
                              helperText="Full URL to your favicon. Recommended: 16x16 or 32x32px, ICO or PNG format. This appears in browser tabs."
                            />
                            {formData.faviconUrl && (
                              <div
                                style={{
                                  marginTop: 'var(--spacing-3)',
                                  padding: 'var(--spacing-4)',
                                  background: '#f9fafb',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 'var(--radius-md)',
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: '600',
                                    marginBottom: 'var(--spacing-2)',
                                    color: '#374151',
                                  }}
                                >
                                  Favicon Preview:
                                </div>
                                <div
                                  style={{
                                    padding: 'var(--spacing-3)',
                                    background: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'inline-block',
                                  }}
                                >
                                  <img
                                    src={formData.faviconUrl}
                                    alt="Favicon preview"
                                    style={{
                                      width: '32px',
                                      height: '32px',
                                      objectFit: 'contain',
                                    }}
                                    onError={e => {
                                      (e.target as HTMLImageElement).style.display = 'none';
                                      const parent = (e.target as HTMLImageElement).parentElement;
                                      if (parent) {
                                        parent.innerHTML =
                                          '<div style="padding: 0.5rem; color: #ef4444; font-size: 0.875rem;">Failed to load favicon. Please check the URL.</div>';
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Color Scheme
                        </h2>
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
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Layout Options
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-3)',
                          }}
                        >
                          <FormField
                            type="select"
                            label="Layout Style"
                            value={formData.layout}
                            onChange={e => setFormData({ ...formData, layout: e.target.value })}
                            options={[
                              { value: 'default', label: 'Default' },
                              { value: 'compact', label: 'Compact' },
                              { value: 'wide', label: 'Wide' },
                            ]}
                          />
                          <Switch
                            checked={formData.showHeader}
                            onChange={checked => setFormData({ ...formData, showHeader: checked })}
                            label="Show Header"
                          />
                          <Switch
                            checked={formData.showFooter}
                            onChange={checked => setFormData({ ...formData, showFooter: checked })}
                            label="Show Footer"
                          />
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Preview
                        </h2>
                        <div
                          style={{
                            padding: 'var(--spacing-6)',
                            background: '#f0f9ff',
                            border: '1px solid #bae6fd',
                            borderRadius: 'var(--radius-md)',
                            textAlign: 'center',
                          }}
                        >
                          <p
                            style={{ fontSize: 'var(--font-size-sm)', color: '#0369a1', margin: 0 }}
                          >
                            Use the <strong>"Show Preview"</strong> button in the top right to see a
                            live preview of your status page. The preview updates in real-time as
                            you make changes.
                          </p>
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Services Configuration */}
                {activeSection === 'services' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Services to Display
                        </h2>
                        <p
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Select which services to show on your status page and configure their
                          display settings.
                        </p>
                        <div style={{ marginBottom: 'var(--spacing-4)' }}>
                          <Switch
                            checked={formData.showServicesByRegion}
                            onChange={checked =>
                              setFormData({ ...formData, showServicesByRegion: checked })
                            }
                            label="Group services by region (public page)"
                            helperText={
                              privacySettings.showServiceRegions === false
                                ? 'Enable “Show Service Regions” in Privacy settings to use region grouping.'
                                : hasSelectedRegions
                                  ? 'Show region headers and group services on the public status page.'
                                  : 'Add regions to selected services to enable grouping.'
                            }
                            disabled={
                              privacySettings.showServiceRegions === false || !hasSelectedRegions
                            }
                          />
                          <Switch
                            checked={formData.showServiceOwners}
                            onChange={checked =>
                              setFormData({ ...formData, showServiceOwners: checked })
                            }
                            label="Show service owners (public page)"
                            helperText={
                              privacySettings.showTeamInformation === false
                                ? 'Enable “Show Team Information” in Privacy settings to display owner badges.'
                                : 'Display “Owned by <team>” badges on service cards.'
                            }
                            disabled={privacySettings.showTeamInformation === false}
                          />
                          <Switch
                            checked={formData.showServiceSlaTier}
                            onChange={checked =>
                              setFormData({ ...formData, showServiceSlaTier: checked })
                            }
                            label="Show SLA tier (public page)"
                            helperText="Display SLA tier badges (e.g., Gold, Silver) on service cards."
                          />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-3)',
                          }}
                        >
                          {allServices.map(service => {
                            const isSelected = selectedServices.has(service.id);
                            const config = serviceConfigs[service.id] || {
                              displayName: '',
                              order: 0,
                              showOnPage: true,
                            };

                            return (
                              <div
                                key={service.id}
                                style={{
                                  padding: 'var(--spacing-4)',
                                  border: '1px solid #e5e7eb',
                                  borderRadius: 'var(--radius-md)',
                                  background: isSelected ? '#f9fafb' : 'white',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-3)',
                                    marginBottom: isSelected ? 'var(--spacing-3)' : '0',
                                  }}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onChange={e => {
                                      const newSet = new Set(selectedServices);
                                      if (e.target.checked) {
                                        newSet.add(service.id);
                                        if (!serviceConfigs[service.id]) {
                                          updateServiceConfig(service.id, {
                                            displayName: '',
                                            order: 0,
                                            showOnPage: true,
                                          });
                                        }
                                      } else {
                                        newSet.delete(service.id);
                                      }
                                      setSelectedServices(newSet);
                                    }}
                                  />
                                  <span style={{ fontWeight: '600', flex: 1 }}>{service.name}</span>
                                </div>
                                {isSelected && (
                                  <div
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '2fr 1fr 1fr',
                                      gap: 'var(--spacing-3)',
                                      marginTop: 'var(--spacing-3)',
                                      paddingTop: 'var(--spacing-3)',
                                      borderTop: '1px solid #e5e7eb',
                                    }}
                                  >
                                    <FormField
                                      type="input"
                                      label="Display Name"
                                      value={config.displayName}
                                      onChange={e =>
                                        updateServiceConfig(service.id, {
                                          displayName: e.target.value,
                                        })
                                      }
                                      placeholder={service.name}
                                      helperText="Override service name on status page"
                                    />
                                    <FormField
                                      type="input"
                                      label="Order"
                                      value={config.order.toString()}
                                      onChange={e =>
                                        updateServiceConfig(service.id, {
                                          order: parseInt(e.target.value) || 0,
                                        })
                                      }
                                      placeholder="0"
                                      helperText="Display order (lower = first)"
                                    />
                                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                      <Switch
                                        checked={config.showOnPage}
                                        onChange={checked =>
                                          updateServiceConfig(service.id, { showOnPage: checked })
                                        }
                                        label="Show on Page"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Privacy Settings */}
                {activeSection === 'privacy' && (
                  <StatusPagePrivacySettings
                    settings={privacySettings}
                    onChange={settings => setPrivacySettings(settings)}
                  />
                )}

                {/* Content Settings */}
                {activeSection === 'content' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Display Options
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-3)',
                          }}
                        >
                          <Switch
                            checked={formData.showServices}
                            onChange={checked =>
                              setFormData({ ...formData, showServices: checked })
                            }
                            label="Show Services"
                            helperText="Display service status list"
                          />
                          <Switch
                            checked={formData.showIncidents}
                            onChange={checked =>
                              setFormData({ ...formData, showIncidents: checked })
                            }
                            label="Show Recent Incidents"
                            helperText="Display recent incidents and their timeline"
                          />
                          <Switch
                            checked={formData.showMetrics}
                            onChange={checked => setFormData({ ...formData, showMetrics: checked })}
                            label="Show Metrics"
                            helperText="Display uptime and performance metrics"
                          />
                          <Switch
                            checked={formData.showSubscribe}
                            onChange={checked =>
                              setFormData({ ...formData, showSubscribe: checked })
                            }
                            label="Show Subscribe to Updates"
                            helperText="Display the email subscription section"
                          />
                          <Switch
                            checked={formData.showChangelog}
                            onChange={checked =>
                              setFormData({ ...formData, showChangelog: checked })
                            }
                            label="Show Changelog"
                            helperText="Display recent update announcements as a changelog feed"
                          />
                          <Switch
                            checked={formData.showRegionHeatmap}
                            onChange={checked =>
                              setFormData({ ...formData, showRegionHeatmap: checked })
                            }
                            label="Show Region Heatmap"
                            helperText="Display a compact region impact grid"
                          />
                          <Switch
                            checked={formData.showPostIncidentReview}
                            onChange={checked =>
                              setFormData({ ...formData, showPostIncidentReview: checked })
                            }
                            label="Show Post-Incident Reviews"
                            helperText="Show links to published postmortems on resolved incidents"
                          />

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
                                      setFormData({ ...formData, uptimeExcellentThreshold: val });
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
                                <div
                                  style={{
                                    marginTop: 'var(--spacing-3)',
                                    padding: 'var(--spacing-2) var(--spacing-3)',
                                    background: '#fef2f2',
                                    border: '1px solid #fecaca',
                                    borderRadius: 'var(--radius-sm)',
                                    fontSize: 'var(--font-size-xs)',
                                    color: '#dc2626',
                                  }}
                                >
                                  ⚠️ Good threshold must be less than or equal to Excellent
                                  threshold
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Footer
                        </h2>
                        <FormField
                          type="textarea"
                          label="Footer Text"
                          rows={3}
                          value={formData.footerText}
                          onChange={e => setFormData({ ...formData, footerText: e.target.value })}
                          placeholder="(c) 2024 Your Company. All rights reserved."
                          helperText="Text to display at the bottom of the status page"
                        />
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          SEO Settings
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-4)',
                          }}
                        >
                          <FormField
                            type="input"
                            label="Meta Title"
                            value={formData.metaTitle}
                            onChange={e => setFormData({ ...formData, metaTitle: e.target.value })}
                            placeholder={statusPage.name}
                            helperText="Page title for search engines (50-60 characters recommended)"
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
                            helperText="Page description for search engines (150-160 characters recommended)"
                          />
                        </div>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Announcements */}
                {activeSection === 'announcements' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 'var(--spacing-3)',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <h2
                              style={{
                                fontSize: 'var(--font-size-xl)',
                                fontWeight: '700',
                                marginBottom: 'var(--spacing-2)',
                              }}
                            >
                              Announcements
                            </h2>
                            <p
                              style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Publish maintenance, incident, and update notices on the status page.
                            </p>
                          </div>
                          <a
                            href="/status"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: 'var(--font-size-sm)',
                              color: 'var(--primary-color)',
                              textDecoration: 'none',
                              fontWeight: '600',
                            }}
                          >
                            View status page
                          </a>
                        </div>
                      </div>
                    </Card>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                        gap: 'var(--spacing-6)',
                      }}
                    >
                      <Card>
                        <div style={{ padding: 'var(--spacing-6)' }}>
                          <h3
                            style={{
                              fontSize: 'var(--font-size-lg)',
                              fontWeight: '600',
                              marginBottom: 'var(--spacing-4)',
                            }}
                          >
                            Create announcement
                          </h3>
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 'var(--spacing-4)',
                            }}
                          >
                            <FormField
                              type="input"
                              label="Title"
                              value={announcementForm.title}
                              onChange={e =>
                                setAnnouncementForm({ ...announcementForm, title: e.target.value })
                              }
                              required
                            />
                            <FormField
                              type="textarea"
                              label="Message"
                              rows={4}
                              value={announcementForm.message}
                              onChange={e =>
                                setAnnouncementForm({
                                  ...announcementForm,
                                  message: e.target.value,
                                })
                              }
                              required
                            />

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
                                  Type
                                </label>
                                <select
                                  value={announcementForm.type}
                                  onChange={e =>
                                    setAnnouncementForm({
                                      ...announcementForm,
                                      type: e.target.value,
                                    })
                                  }
                                  style={{
                                    width: '100%',
                                    padding: 'var(--spacing-3)',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: 'var(--font-size-sm)',
                                    background: 'white',
                                  }}
                                >
                                  {ANNOUNCEMENT_TYPES.map(type => (
                                    <option key={type.value} value={type.value}>
                                      {type.label}
                                    </option>
                                  ))}
                                </select>
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
                                  Start Date
                                </label>
                                <input
                                  type="date"
                                  value={announcementForm.startDate}
                                  onChange={e =>
                                    setAnnouncementForm({
                                      ...announcementForm,
                                      startDate: e.target.value,
                                    })
                                  }
                                  style={{
                                    width: '100%',
                                    padding: 'var(--spacing-3)',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: 'var(--font-size-sm)',
                                  }}
                                />
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
                                  End Date (optional)
                                </label>
                                <input
                                  type="date"
                                  value={announcementForm.endDate}
                                  onChange={e =>
                                    setAnnouncementForm({
                                      ...announcementForm,
                                      endDate: e.target.value,
                                    })
                                  }
                                  style={{
                                    width: '100%',
                                    padding: 'var(--spacing-3)',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: 'var(--font-size-sm)',
                                  }}
                                />
                              </div>
                            </div>

                            <div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 'var(--spacing-2)',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <label
                                  style={{
                                    display: 'block',
                                    fontSize: 'var(--font-size-sm)',
                                    fontWeight: '500',
                                  }}
                                >
                                  Affected Services (optional)
                                </label>
                                {announcementServiceOptions.length > 0 && (
                                  <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
                                    <button
                                      type="button"
                                      onClick={handleAnnouncementServiceSelectAll}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: '999px',
                                        border: '1px solid #e5e7eb',
                                        background: 'white',
                                        fontSize: 'var(--font-size-xs)',
                                        fontWeight: '600',
                                        color: 'var(--text-muted)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Select all
                                    </button>
                                    <button
                                      type="button"
                                      onClick={handleAnnouncementServiceClear}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: '999px',
                                        border: '1px solid #e5e7eb',
                                        background: 'white',
                                        fontSize: 'var(--font-size-xs)',
                                        fontWeight: '600',
                                        color: 'var(--text-muted)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      Clear
                                    </button>
                                  </div>
                                )}
                              </div>
                              {announcementServiceOptions.length === 0 ? (
                                <div
                                  style={{
                                    marginTop: 'var(--spacing-2)',
                                    padding: 'var(--spacing-3)',
                                    border: '1px dashed #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: 'var(--font-size-sm)',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  Select services in the Services section to link them to
                                  announcements.
                                </div>
                              ) : (
                                <div
                                  style={{
                                    marginTop: 'var(--spacing-2)',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-3)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 'var(--spacing-2)',
                                    maxHeight: '220px',
                                    overflowY: 'auto',
                                  }}
                                >
                                  {announcementServiceOptions.map(service => {
                                    const isChecked = announcementForm.affectedServiceIds.includes(
                                      service.id
                                    );
                                    const regions = service.region
                                      ? service.region
                                          .split(',')
                                          .map(entry => entry.trim())
                                          .filter(Boolean)
                                      : [];
                                    return (
                                      <label
                                        key={service.id}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 'var(--spacing-2)',
                                          fontSize: 'var(--font-size-sm)',
                                          color: 'var(--text-primary)',
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() =>
                                            handleAnnouncementServiceToggle(service.id)
                                          }
                                        />
                                        <span style={{ fontWeight: '600' }}>{service.name}</span>
                                        {regions.length > 0 && (
                                          <span
                                            style={{
                                              display: 'inline-flex',
                                              gap: '4px',
                                              flexWrap: 'wrap',
                                            }}
                                          >
                                            {regions.map(region => (
                                              <span
                                                key={`${service.id}-${region}`}
                                                style={{
                                                  padding: '2px 6px',
                                                  borderRadius: '999px',
                                                  fontSize: '10px',
                                                  fontWeight: '600',
                                                  background: '#f8fafc',
                                                  border: '1px solid #e2e8f0',
                                                  color: '#475569',
                                                }}
                                              >
                                                {region}
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                gap: 'var(--spacing-4)',
                                marginTop: 'var(--spacing-2)',
                              }}
                            >
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 'var(--spacing-2)',
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: '500',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={announcementForm.isActive}
                                  onChange={e =>
                                    setAnnouncementForm({
                                      ...announcementForm,
                                      isActive: e.target.checked,
                                    })
                                  }
                                />
                                Active
                              </label>

                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 'var(--spacing-2)',
                                  fontSize: 'var(--font-size-sm)',
                                  fontWeight: '500',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={announcementForm.notifySubscribers}
                                  onChange={e =>
                                    setAnnouncementForm({
                                      ...announcementForm,
                                      notifySubscribers: e.target.checked,
                                    })
                                  }
                                />
                                Email Subscribers
                              </label>
                            </div>

                            {announcementError && (
                              <div
                                style={{
                                  color: 'var(--color-error-dark)',
                                  fontSize: 'var(--font-size-sm)',
                                }}
                              >
                                {announcementError}
                              </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                              <Button
                                type="button"
                                variant="primary"
                                isLoading={isAnnouncementPending}
                                onClick={handleAnnouncementCreate}
                              >
                                Add Announcement
                              </Button>
                            </div>
                          </div>
                        </div>
                      </Card>

                      <Card>
                        <div style={{ padding: 'var(--spacing-6)' }}>
                          <h3
                            style={{
                              fontSize: 'var(--font-size-lg)',
                              fontWeight: '600',
                              marginBottom: 'var(--spacing-4)',
                            }}
                          >
                            Recent announcements
                          </h3>
                          {announcements.length === 0 ? (
                            <p
                              style={{
                                fontSize: 'var(--font-size-sm)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              No announcements yet.
                            </p>
                          ) : (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'var(--spacing-3)',
                              }}
                            >
                              {announcements.map(announcement => {
                                const typeConfig =
                                  ANNOUNCEMENT_TYPES.find(
                                    type => type.value === announcement.type
                                  ) || ANNOUNCEMENT_TYPES[4];
                                const affectedServices = buildAnnouncementAffectedServices(
                                  announcement.affectedServiceIds
                                );
                                const affectedRegions = getAnnouncementRegions(affectedServices);
                                return (
                                  <div
                                    key={announcement.id}
                                    style={{
                                      padding: 'var(--spacing-4)',
                                      border: '1px solid #e5e7eb',
                                      borderRadius: 'var(--radius-md)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 'var(--spacing-2)',
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--spacing-2)',
                                      }}
                                    >
                                      <span
                                        style={{
                                          padding: '0.2rem 0.6rem',
                                          borderRadius: '999px',
                                          fontSize: 'var(--font-size-xs)',
                                          fontWeight: '600',
                                          background: typeConfig.background,
                                          color: typeConfig.color,
                                        }}
                                      >
                                        {typeConfig.label}
                                      </span>
                                      {!announcement.isActive && (
                                        <span
                                          style={{
                                            fontSize: 'var(--font-size-xs)',
                                            color: 'var(--text-muted)',
                                          }}
                                        >
                                          Inactive
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ fontWeight: '600' }}>{announcement.title}</div>
                                    <div
                                      style={{
                                        fontSize: 'var(--font-size-sm)',
                                        color: 'var(--text-muted)',
                                        whiteSpace: 'pre-wrap',
                                      }}
                                    >
                                      {announcement.message}
                                    </div>
                                    {affectedServices.length > 0 && (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 'var(--spacing-2)',
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontSize: 'var(--font-size-xs)',
                                            color: 'var(--text-muted)',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.08em',
                                          }}
                                        >
                                          Affected services
                                        </div>
                                        <div
                                          style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}
                                        >
                                          {affectedServices.map(service => (
                                            <span
                                              key={service.id}
                                              style={{
                                                padding: '4px 8px',
                                                borderRadius: '999px',
                                                background: '#f8fafc',
                                                border: '1px solid #e2e8f0',
                                                fontSize: 'var(--font-size-xs)',
                                                fontWeight: '600',
                                                color: 'var(--text-primary)',
                                              }}
                                            >
                                              {service.name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {affectedRegions.length > 0 && (
                                      <div
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: 'var(--spacing-2)',
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontSize: 'var(--font-size-xs)',
                                            color: 'var(--text-muted)',
                                            fontWeight: '600',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.08em',
                                          }}
                                        >
                                          Regions
                                        </div>
                                        <div
                                          style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}
                                        >
                                          {affectedRegions.map(region => (
                                            <span
                                              key={`${announcement.id}-${region}`}
                                              style={{
                                                padding: '2px 8px',
                                                borderRadius: '999px',
                                                border: '1px solid #e2e8f0',
                                                fontSize: 'var(--font-size-xs)',
                                                fontWeight: '600',
                                                color: 'var(--text-muted)',
                                                background: '#ffffff',
                                              }}
                                            >
                                              {region}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    <div
                                      style={{
                                        fontSize: 'var(--font-size-xs)',
                                        color: 'var(--text-muted)',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                        gap: 'var(--spacing-2)',
                                      }}
                                    >
                                      <span>
                                        {formatDateTime(announcement.startDate, browserTimeZone, {
                                          format: 'date',
                                        })}{' '}
                                        {announcement.endDate
                                          ? `- ${formatDateTime(announcement.endDate, browserTimeZone, { format: 'date' })}`
                                          : ''}
                                      </span>
                                      <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={() => handleAnnouncementDelete(announcement.id)}
                                        isLoading={isAnnouncementPending}
                                      >
                                        Delete
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </Card>
                    </div>
                  </div>
                )}

                {/* Custom CSS */}
                {activeSection === 'customization' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Custom CSS
                        </h2>
                        <p
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Add custom CSS to fully customize your status page appearance. This CSS
                          will be injected into the status page.
                        </p>
                        <div style={{ marginBottom: 'var(--spacing-5)' }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginBottom: 'var(--spacing-3)',
                              flexWrap: 'wrap',
                              gap: 'var(--spacing-3)',
                            }}
                          >
                            <div>
                              <h3
                                style={{
                                  fontSize: 'var(--font-size-lg)',
                                  fontWeight: '700',
                                  margin: 0,
                                }}
                              >
                                Templates
                              </h3>
                              <div
                                style={{
                                  fontSize: 'var(--font-size-xs)',
                                  color: 'var(--text-muted)',
                                  marginTop: '4px',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 'var(--font-size-xs)',
                                    color: 'var(--text-muted)',
                                  }}
                                >
                                  {visibleTemplates.length} of {STATUS_PAGE_TEMPLATES.length}{' '}
                                  templates
                                </span>
                              </div>
                            </div>
                            {selectedTemplate && (
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.5rem',
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '999px',
                                  background: '#eef2ff',
                                  color: '#4338ca',
                                  border: '1px solid #c7d2fe',
                                  fontSize: 'var(--font-size-xs)',
                                  fontWeight: '600',
                                }}
                                className="status-page-template-active"
                              >
                                Selected: {selectedTemplate.name}
                              </div>
                            )}
                            <div
                              style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}
                            >
                              {TEMPLATE_FILTERS.map(filter => (
                                <button
                                  key={filter.id}
                                  type="button"
                                  onClick={() => setTemplateFilter(filter.id)}
                                  style={{
                                    padding: '6px 12px',
                                    borderRadius: '999px',
                                    border: `1px solid ${templateFilter === filter.id ? 'var(--primary-color)' : '#e5e7eb'}`,
                                    background:
                                      templateFilter === filter.id
                                        ? 'var(--primary-color)'
                                        : 'white',
                                    color:
                                      templateFilter === filter.id ? 'white' : 'var(--text-muted)',
                                    fontSize: 'var(--font-size-xs)',
                                    fontWeight: templateFilter === filter.id ? '600' : '500',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                  }}
                                >
                                  {filter.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          {templateError && (
                            <div
                              style={{
                                padding: 'var(--spacing-2) var(--spacing-3)',
                                borderRadius: 'var(--radius-md)',
                                background: '#fee2e2',
                                border: '1px solid #fecaca',
                                color: '#991b1b',
                                fontSize: 'var(--font-size-sm)',
                                marginBottom: 'var(--spacing-3)',
                              }}
                            >
                              {templateError}
                            </div>
                          )}
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                              gap: 'var(--spacing-4)',
                            }}
                          >
                            {visibleTemplates.map(template => {
                              const isSelected = selectedTemplateId === template.id;
                              const isA11y = template.id === 'clear-contrast';
                              return (
                                <div
                                  key={template.id}
                                  style={{
                                    borderRadius: 'var(--radius-lg)',
                                    overflow: 'hidden',
                                    border: isSelected
                                      ? '2px solid var(--primary-color)'
                                      : '1px solid #e2e8f0',
                                    background: 'white',
                                    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.08)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    minHeight: '270px',
                                    position: 'relative',
                                  }}
                                >
                                  {isSelected && (
                                    <div
                                      style={{
                                        position: 'absolute',
                                        top: '12px',
                                        right: '12px',
                                        padding: '4px 10px',
                                        borderRadius: '999px',
                                        background: 'var(--primary-color)',
                                        color: 'white',
                                        fontSize: '10px',
                                        fontWeight: '700',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        zIndex: 1,
                                      }}
                                    >
                                      Selected
                                    </div>
                                  )}
                                  <div
                                    style={{
                                      height: '170px',
                                      background: getTemplateGradient(template.colors),
                                      position: 'relative',
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {templateCssMap[template.id] ? (
                                      <iframe
                                        title={`${template.name} preview`}
                                        style={{
                                          border: 'none',
                                          width: '100%',
                                          height: '100%',
                                          display: 'block',
                                          background: 'transparent',
                                        }}
                                        sandbox=""
                                        srcDoc={buildTemplatePreviewHtml(
                                          templateCssMap[template.id],
                                          template.name
                                        )}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          position: 'absolute',
                                          inset: 0,
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: 'var(--font-size-xs)',
                                          color: 'rgba(15, 23, 42, 0.6)',
                                          fontWeight: '600',
                                        }}
                                      >
                                        Loading preview...
                                      </div>
                                    )}
                                  </div>
                                  <div
                                    className="status-page-template-meta"
                                    style={{
                                      padding: 'var(--spacing-3)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 'var(--spacing-3)',
                                      flex: 1,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 'var(--spacing-2)',
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontWeight: '700',
                                          fontSize: 'var(--font-size-sm)',
                                        }}
                                      >
                                        {template.name}
                                      </div>
                                      <div style={{ display: 'flex', gap: '6px' }}>
                                        {template.colors.slice(0, 3).map(color => (
                                          <span
                                            key={`${template.id}-${color}`}
                                            style={{
                                              width: '12px',
                                              height: '12px',
                                              borderRadius: '999px',
                                              background: color,
                                              border: '1px solid rgba(15, 23, 42, 0.15)',
                                            }}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: '10px',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.08em',
                                          color: 'var(--text-muted)',
                                        }}
                                      >
                                        {template.category}
                                      </span>
                                      {isA11y && (
                                        <span
                                          style={{
                                            fontSize: '10px',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.08em',
                                            padding: '2px 8px',
                                            borderRadius: '999px',
                                            background: '#d1fae5',
                                            color: '#065f46',
                                            border: '1px solid #6ee7b7',
                                            fontWeight: '700',
                                          }}
                                        >
                                          A11y
                                        </span>
                                      )}
                                    </div>
                                    <Button
                                      type="button"
                                      variant={isSelected ? 'primary' : 'secondary'}
                                      onClick={() => handleApplyTemplate(template)}
                                      isLoading={templateLoadingId === template.id}
                                    >
                                      {isSelected ? 'Selected' : 'Use Template'}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div
                          style={{
                            height: '1px',
                            background: '#e5e7eb',
                            margin: 'var(--spacing-5) 0',
                          }}
                        />
                        <div style={{ marginBottom: 'var(--spacing-4)' }}>
                          <label
                            style={{
                              display: 'block',
                              marginBottom: 'var(--spacing-2)',
                              fontSize: 'var(--font-size-sm)',
                              fontWeight: '500',
                            }}
                          >
                            Custom CSS Code
                          </label>
                          <textarea
                            value={formData.customCss}
                            onChange={e => {
                              setFormData({ ...formData, customCss: e.target.value });
                              setSelectedTemplateId(null);
                            }}
                            placeholder="/* Your custom CSS here */&#10;.status-page-header {&#10;  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);&#10;}"
                            rows={15}
                            style={{
                              width: '100%',
                              padding: 'var(--spacing-3)',
                              border: '1px solid #e5e7eb',
                              borderRadius: 'var(--radius-md)',
                              fontFamily: 'monospace',
                              fontSize: '0.875rem',
                              lineHeight: '1.6',
                              resize: 'vertical',
                            }}
                          />
                        </div>
                        <div
                          style={{
                            padding: 'var(--spacing-3)',
                            background: '#f8fafc',
                            border: '1px solid #e5e7eb',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          Use <code>.status-page-header</code>, <code>.status-service-card</code>,
                          and <code>.status-incident-card</code> to target key UI blocks.
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Preview
                        </h2>
                        <a
                          href="/status"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'inline-block',
                            padding: 'var(--spacing-3) var(--spacing-5)',
                            background: 'var(--primary-color)',
                            color: 'white',
                            textDecoration: 'none',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--font-size-sm)',
                            fontWeight: '600',
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'var(--primary-hover)';
                            e.currentTarget.style.transform = 'translateY(-1px)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'var(--primary-color)';
                            e.currentTarget.style.transform = 'translateY(0)';
                          }}
                        >
                          View Status Page
                        </a>
                        <p
                          style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--text-muted)',
                            marginTop: 'var(--spacing-2)',
                          }}
                        >
                          Open in a new tab to preview your changes
                        </p>
                      </div>
                    </Card>
                  </div>
                )}

                {/* Integrations */}
                {activeSection === 'integrations' && (
                  <StatusPageWebhooksSettings statusPageId={statusPage.id} />
                )}

                {/* Subscribers */}
                {activeSection === 'subscribers' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-2)',
                          }}
                        >
                          Email Delivery
                        </h2>
                        <p
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Choose the email provider used for subscription updates.
                        </p>
                        <StatusPageEmailConfig
                          statusPageId={statusPage.id}
                          currentProvider={statusPage.emailProvider}
                        />
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-2)',
                          }}
                        >
                          Subscribers
                        </h2>
                        <p
                          style={{
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--text-muted)',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Manage subscriber list and verification status.
                        </p>
                        <StatusPageSubscribers statusPageId={statusPage.id} />
                      </div>
                    </Card>
                  </div>
                )}

                {/* Advanced Settings */}
                {activeSection === 'advanced' && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}
                  >
                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Auto-Refresh
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-4)',
                          }}
                        >
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
                              placeholder="60"
                              helperText="How often to refresh the page (minimum: 30 seconds)"
                            />
                          )}
                        </div>
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          API & Feeds
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--spacing-3)',
                          }}
                        >
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
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Status API Access
                        </h2>
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
                                    setFormData({ ...formData, statusApiRateLimitWindowSec: val });
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
                            <form
                              onSubmit={handleCreateApiToken}
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 'var(--spacing-3)',
                                alignItems: 'flex-end',
                              }}
                            >
                              <FormField
                                type="input"
                                label="Token name"
                                value={apiTokenName}
                                onChange={e => setApiTokenName(e.target.value)}
                                placeholder="e.g. External status monitor"
                                required
                              />
                              <Button type="submit" variant="primary" isLoading={apiTokenPending}>
                                Create token
                              </Button>
                            </form>
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
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          Uptime Reports
                        </h2>
                        <Switch
                          checked={formData.enableUptimeExports}
                          onChange={checked =>
                            setFormData({ ...formData, enableUptimeExports: checked })
                          }
                          label="Enable uptime exports"
                          helperText="Allow admins to download monthly uptime reports."
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
                              style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}
                            >
                              <a
                                href="/api/status/uptime-export?format=csv"
                                className="glass-button"
                                style={{ padding: '0.5rem 1rem', textDecoration: 'none' }}
                              >
                                Download CSV
                              </a>
                              <a
                                href="/api/status/uptime-export?format=pdf"
                                className="glass-button"
                                style={{ padding: '0.5rem 1rem', textDecoration: 'none' }}
                              >
                                Download PDF
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>

                    <Card>
                      <div style={{ padding: 'var(--spacing-6)' }}>
                        <h2
                          style={{
                            fontSize: 'var(--font-size-xl)',
                            fontWeight: '700',
                            marginBottom: 'var(--spacing-4)',
                          }}
                        >
                          API Endpoints
                        </h2>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
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
                    </Card>
                  </div>
                )}

                {/* Error and Success Messages */}
                {(error || successMessage) && (
                  <div
                    style={{
                      marginBottom: 'var(--spacing-4)',
                      padding: 'var(--spacing-3)',
                      borderRadius: 'var(--radius-md)',
                      background: error ? '#fee2e2' : '#d1fae5',
                      border: `1px solid ${error ? '#fecaca' : '#a7f3d0'}`,
                      color: error ? '#991b1b' : '#065f46',
                    }}
                  >
                    {error ? (
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}
                      >
                        <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                        <span>{error}</span>
                      </div>
                    ) : (
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}
                      >
                        <span style={{ fontSize: '1.2rem' }}>✓</span>
                        <span>{successMessage}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Sticky Save Bar */}
            <div
              className="status-page-config-sticky-bar"
              style={{
                display: 'flex',
                gap: 'var(--spacing-3)',
                justifyContent: 'flex-end',
                alignItems: 'center',
                padding: 'var(--spacing-4) var(--spacing-6)',
                borderTop: '1px solid #e5e7eb',
                background: 'linear-gradient(to right, #ffffff, #fafafa)',
                boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.05)',
              }}
            >
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.refresh()}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isPending}>
                💾 Save Settings
              </Button>
            </div>
          </div>

          {/* Preview Panel */}
          {showPreview && (
            <div
              className="status-page-config-preview"
              style={{
                flex: '0 0 42%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minWidth: 0, // Allow flex item to shrink below content size
              }}
            >
              <div className="status-page-preview-body">
                <div className="status-page-preview-header">
                  <span>Live Preview</span>
                  <span className="status-page-preview-chip">Live</span>
                </div>
                <div className="status-page-preview-frame">
                  <StatusPageLivePreview previewData={previewData} maxWidth={previewMaxWidth} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </form>
  );
}
