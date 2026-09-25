'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import {
  Book,
  Github,
  ExternalLink,
  HelpCircle,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  ArrowRight,
  Radio,
  Server,
  KeyRound,
  MessageSquare,
  MessageCircle,
  AlertCircle,
  Heart,
  Search,
  Filter,
  Calendar,
  Layers,
  Activity,
  X,
} from 'lucide-react';
import { APP_VERSION } from '@/lib/constants';
import { cn } from '@/lib/utils';

type DocTopic = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  href: string;
  details: string[];
};

const DOC_TOPICS: DocTopic[] = [
  {
    id: 'self-hosting',
    title: 'Self-Hosting & Deployment',
    description:
      'Docker Compose recipes, Helm charts, environment variables, PostgreSQL schemas, and persistent volume configuration.',
    icon: Server,
    iconBg: 'bg-blue-500/10 dark:bg-blue-500/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    href: 'https://opsknight.com/docs',
    details: [
      'Docker Compose & Kubernetes deployment',
      'PostgreSQL migrations & backup procedures',
      'Environment variables & secret management',
    ],
  },
  {
    id: 'alert-ingestion',
    title: 'Alert Ingestion & Webhooks',
    description:
      'Ingest alerts from Prometheus Alertmanager, Datadog, AWS CloudWatch, Grafana, Sentry, and custom JSON payloads.',
    icon: Radio,
    iconBg: 'bg-amber-500/10 dark:bg-amber-500/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
    href: 'https://opsknight.com/docs',
    details: [
      'Payload schema & deduplication keys',
      'Severity mapping (P1 through P4)',
      'Rate-limiting & incoming webhook verification',
    ],
  },
  {
    id: 'chatops-collaboration',
    title: 'ChatOps & War Rooms',
    description:
      'Configure bidirectional Slack and Microsoft Teams bots for automated war-room channel creation and responder paging.',
    icon: MessageSquare,
    iconBg: 'bg-purple-500/10 dark:bg-purple-500/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
    href: 'https://opsknight.com/docs',
    details: [
      'Slack App manifest & Event Subscriptions setup',
      'Microsoft Teams application package upload',
      'Bidirectional card actions (Ack & Resolve)',
    ],
  },
  {
    id: 'rest-api-automation',
    title: 'REST API & Automation',
    description:
      'Automate incident management, programmatic responder schedules, on-call queries, and SCIM directory synchronization.',
    icon: KeyRound,
    iconBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    href: 'https://opsknight.com/docs',
    details: [
      'Bearer token authentication & scoping',
      'SCIM v2 automated user provisioning',
      'Incident lifecycle programmatic triggers',
    ],
  },
];

type FAQCategory = {
  id: string;
  label: string;
  icon: React.ElementType;
};

const FAQ_CATEGORIES: FAQCategory[] = [
  { id: 'all', label: 'All Topics', icon: Layers },
  { id: 'routing', label: 'Alerts & Routing', icon: Radio },
  { id: 'dedup', label: 'Deduplication', icon: Filter },
  { id: 'chatops', label: 'ChatOps & War Rooms', icon: MessageSquare },
  { id: 'schedules', label: 'On-Call & Schedules', icon: Calendar },
  { id: 'api', label: 'API & Automation', icon: KeyRound },
  { id: 'postmortems', label: 'Postmortems & Review', icon: Activity },
];

type FAQItem = {
  id: string;
  categoryId: string;
  categoryLabel: string;
  question: string;
  answer: string;
  tags: string[];
};

const FAQS: FAQItem[] = [
  {
    id: 'faq-routing',
    categoryId: 'routing',
    categoryLabel: 'Alerts & Routing',
    question: 'How do incoming alerts route to the correct on-call engineer?',
    answer:
      'Incoming alerts match a registered Service via API token or webhook route. Each Service is linked to an Escalation Policy. The policy identifies the current on-call engineer based on the active Schedule rotation and begins notifying Tier 1 responders. If unacknowledged within the configured SLA escalation delay, it automatically escalates to Tier 2.',
    tags: ['alerts', 'routing', 'escalation', 'sla'],
  },
  {
    id: 'faq-dedup',
    categoryId: 'dedup',
    categoryLabel: 'Deduplication',
    question: 'How does alert deduplication prevent notification storms?',
    answer:
      'OpsKnight extracts or computes a dedup_key from incoming alert payloads. When multiple alerts share the same deduplication key and the incident is already OPEN or ACKNOWLEDGED, OpsKnight appends the subsequent alerts to the existing incident timeline instead of creating duplicate incidents or dispatching duplicate pages.',
    tags: ['deduplication', 'grouping', 'alerts', 'noise'],
  },
  {
    id: 'faq-chatops',
    categoryId: 'chatops',
    categoryLabel: 'ChatOps & War Rooms',
    question: 'How do Slack and Microsoft Teams war rooms sync?',
    answer:
      'When an incident triggers, OpsKnight can automatically generate a dedicated channel in your workspace and post an adaptive card. Any updates made in OpsKnight reflect in the channel in real time. Actions clicked in Teams or Slack (Acknowledge, Resolve, Add Note) verify responder identity and immediately sync back.',
    tags: ['slack', 'teams', 'war rooms', 'chatops'],
  },
  {
    id: 'faq-schedules',
    categoryId: 'schedules',
    categoryLabel: 'On-Call & Schedules',
    question: 'What happens during a shift override if the substitute is unavailable?',
    answer:
      'If an on-call substitute does not acknowledge the incident within the escalation window, the Escalation Policy automatically progresses to the next escalation tier (such as secondary on-call, team lead, or backup schedule), ensuring no incident is ever dropped.',
    tags: ['override', 'schedules', 'fallback', 'escalation'],
  },
  {
    id: 'faq-api',
    categoryId: 'api',
    categoryLabel: 'API & Automation',
    question: 'How do I generate an API key for CI/CD or custom monitoring scripts?',
    answer:
      'Admins and responders can generate scoped API keys under Settings → API Keys (/settings/api-keys). You can assign granular read/write scopes, set expiration periods, and revoke keys at any moment. Requests to the OpsKnight REST API require an Authorization: Bearer <key> header.',
    tags: ['api', 'tokens', 'scripts', 'automation'],
  },
  {
    id: 'faq-postmortems',
    categoryId: 'postmortems',
    categoryLabel: 'Postmortems & Review',
    question: 'How are postmortems and action items tracked?',
    answer:
      'Once an incident is resolved, responders can initiate a postmortem with an automated timeline of key events. Action items identified during the review can be tracked directly within OpsKnight or synchronized with external issue trackers like Jira to ensure preventative measures are completed.',
    tags: ['postmortem', 'action items', 'jira', 'review'],
  },
];

export default function HelpPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'ADMIN';

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [openFaqId, setOpenFaqId] = useState<string | null>('faq-routing');

  const filteredFaqs = useMemo(() => {
    let result = FAQS;

    if (selectedCategory !== 'all') {
      result = result.filter(faq => faq.categoryId === selectedCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        faq =>
          faq.question.toLowerCase().includes(q) ||
          faq.answer.toLowerCase().includes(q) ||
          faq.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    return result;
  }, [selectedCategory, searchQuery]);

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-6 md:px-6 md:py-8">
      {/* Top Centralized Hero Banner matching Users/Action-Items/Incidents pages */}
      <DetailHeroBanner
        tag="Documentation & Resources"
        title="Help Center"
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/15 text-primary-foreground ring-1 ring-inset ring-primary-foreground/20">
            <HelpCircle className="h-6 w-6" aria-hidden="true" />
          </div>
        }
        badges={
          <Badge
            variant="outline"
            className="text-[10px] font-mono font-medium border-white/20 text-white/90 bg-white/10"
          >
            {APP_VERSION}
          </Badge>
        }
        subtitle={
          <p className="text-xs text-primary-foreground/85 leading-relaxed">
            Official documentation, self-hosting guides, system health diagnostics, FAQs, and
            open-source maintainer support.
          </p>
        }
        actions={
          <div className="flex items-center gap-2.5 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 h-9 border-pink-500/40 hover:border-pink-500/60 bg-pink-500/10 hover:bg-pink-500/20 text-pink-200 transition-all shadow-2xs cursor-pointer"
            >
              <a
                href="https://github.com/sponsors/Dushyant-rahangdale"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Heart className="h-4 w-4 text-pink-400 fill-pink-400" />
                <span className="font-semibold text-white">Sponsor</span>
              </a>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
              className="gap-1.5 text-xs h-9 border-white/20 bg-white/10 hover:bg-white/15 text-white shadow-2xs cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-blue-300" />
              <span>Hotkeys</span>
              <kbd className="font-mono text-[10px] bg-white/15 px-1 rounded border border-white/20 text-white">
                ?
              </kbd>
            </Button>

            <Button
              size="sm"
              asChild
              className="gap-2 h-9 shadow-2xs bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer"
            >
              <a href="https://opsknight.com/docs" target="_blank" rel="noopener noreferrer">
                <Book className="h-4 w-4" />
                <span>Docs</span>
                <ExternalLink className="h-3 w-3 opacity-70" />
              </a>
            </Button>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Documentation',
            value: `${DOC_TOPICS.length} Guides`,
            icon: <Book className="h-3.5 w-3.5 text-blue-200" />,
            href: 'https://opsknight.com/docs',
          },
          {
            label: 'Status',
            value: 'Operational',
            icon: <Activity className="h-3.5 w-3.5 text-emerald-200" />,
            valueClassName: 'text-emerald-200',
            href: '/status',
          },
          {
            label: 'Curated FAQs',
            value: `${FAQS.length} Answers`,
            icon: <HelpCircle className="h-3.5 w-3.5 text-amber-200" />,
            valueClassName: 'text-amber-200',
          },
          {
            label: 'Release',
            value: APP_VERSION,
            icon: <Radio className="h-3.5 w-3.5 text-purple-200" />,
            valueClassName: 'text-purple-200',
          },
        ]}
      />

      {/* Main Grid: Documentation Guides (Left 8 cols) + System Diagnostics (Right 4 cols) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Documentation & Platform Diagnostics
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Official technical documentation, deployment guides, and live operational diagnostic
              tools.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="gap-1.5 text-xs h-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <a href="https://opsknight.com/docs" target="_blank" rel="noopener noreferrer">
              <span>View full documentation</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Documentation Cards Grid (8 cols) */}
          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {DOC_TOPICS.map(topic => {
              const Icon = topic.icon;
              return (
                <Card
                  key={topic.id}
                  className="flex flex-col border-border/80 bg-card/80 backdrop-blur-xs hover:border-border transition-all duration-150 shadow-2xs group"
                >
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-xl border border-border/40 shadow-2xs',
                          topic.iconBg,
                          topic.iconColor
                        )}
                      >
                        <Icon className="h-4.5 w-4.5" />
                      </div>
                      <a
                        href={topic.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
                      >
                        <span>Docs</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <CardTitle className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {topic.title}
                    </CardTitle>
                    <CardDescription className="text-xs leading-relaxed line-clamp-2">
                      {topic.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-4 pt-1 mt-auto">
                    <div className="space-y-1.5 pt-2 border-t border-border/50">
                      {topic.details.map((detail, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <CheckCircle2 className="h-3 w-3 text-primary/70 shrink-0" />
                          <span className="truncate">{detail}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* System & Diagnostics Card (4 cols, full height match) */}
          <Card className="lg:col-span-4 flex flex-col justify-between border-border/80 bg-card/80 backdrop-blur-xs hover:border-border transition-all duration-150 shadow-2xs">
            <div>
              <CardHeader className="p-5 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                    <Activity className="h-5 w-5" />
                  </div>
                  <Badge variant="outline" className="text-2xs font-mono text-muted-foreground">
                    {APP_VERSION}
                  </Badge>
                </div>
                <CardTitle className="text-base font-semibold text-foreground">
                  System & Diagnostics
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  Real-time infrastructure health checks, system event logs, and public status
                  monitor.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 pt-0">
                <div className="space-y-3 pt-2 border-t border-border/60 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground py-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Public Status</span>
                    </div>
                    <Link
                      href="/status"
                      className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                    >
                      Status Page
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>

                  {isAdmin ? (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Instance Health</span>
                        <Link
                          href="/settings/system/health"
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          Health Checks
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Platform Logs</span>
                        <Link
                          href="/system-logs"
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          System Logs
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Keyboard Hotkeys</span>
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))
                          }
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          View Overlay
                          <kbd className="font-mono text-[10px] bg-muted px-1 rounded border">
                            ?
                          </kbd>
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Documentation</span>
                        <a
                          href="https://opsknight.com/docs"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          Online Docs
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </div>

            <div className="p-5 pt-0">
              <Button
                variant="outline"
                size="sm"
                asChild
                className="w-full justify-between text-xs h-9"
              >
                <Link href="/status">
                  <span>View public status dashboard</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </Card>
        </div>
      </section>

      {/* Frequently Asked Questions with Clean Sidebar Layout */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Curated answers organized by category, with search and troubleshooting guides.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* FAQ Sidebar (3 cols on large screens) */}
          <div className="lg:col-span-3.5 xl:col-span-3 space-y-4">
            {/* Search Box */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search FAQs…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8.5 pr-8 h-9 text-xs bg-card shadow-2xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs p-0.5 rounded cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Category Navigation */}
            <div className="rounded-xl border border-border/80 bg-card p-1.5 space-y-1 shadow-2xs">
              <div className="px-2.5 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Categories
              </div>
              {FAQ_CATEGORIES.map(category => {
                const Icon = category.icon;
                const count =
                  category.id === 'all'
                    ? FAQS.length
                    : FAQS.filter(f => f.categoryId === category.id).length;
                const isSelected = selectedCategory === category.id;

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => {
                      setSelectedCategory(category.id);
                      const firstMatch =
                        category.id === 'all'
                          ? FAQS[0]
                          : FAQS.find(f => f.categoryId === category.id);
                      if (firstMatch) setOpenFaqId(firstMatch.id);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all text-left cursor-pointer',
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-2xs font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    )}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          isSelected ? 'text-primary-foreground' : 'text-muted-foreground'
                        )}
                      />
                      <span className="truncate">{category.label}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] px-1.5 py-0 h-4 font-mono ml-2 shrink-0 border-0',
                        isSelected
                          ? 'bg-primary-foreground/20 text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {count}
                    </Badge>
                  </button>
                );
              })}
            </div>

            {/* Sidebar Support Callout */}
            <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-2 shadow-2xs">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <MessageCircle className="h-4 w-4 text-primary" />
                <span>Can&apos;t find an answer?</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Connect with the open-source maintainers on GitHub Discussions for troubleshooting
                help.
              </p>
              <a
                href="https://github.com/opsknight-labs/OpsKnight/discussions"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium pt-1"
              >
                <span>Ask Maintainers</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* FAQ Content Area (9 cols on large screens) */}
          <div className="lg:col-span-8.5 xl:col-span-9 space-y-3">
            {/* Header info bar */}
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span>
                Showing{' '}
                <strong className="text-foreground font-semibold">{filteredFaqs.length}</strong>{' '}
                {filteredFaqs.length === 1 ? 'question' : 'questions'}
                {selectedCategory !== 'all' && (
                  <>
                    {' '}
                    in{' '}
                    <span className="text-foreground font-medium">
                      {FAQ_CATEGORIES.find(c => c.id === selectedCategory)?.label}
                    </span>
                  </>
                )}
                {searchQuery && (
                  <>
                    {' '}
                    matching &ldquo;<span className="text-foreground">{searchQuery}</span>&rdquo;
                  </>
                )}
              </span>

              {(selectedCategory !== 'all' || searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('all');
                    setSearchQuery('');
                  }}
                  className="text-xs text-primary hover:underline cursor-pointer"
                >
                  Reset filters
                </button>
              )}
            </div>

            {filteredFaqs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/80 p-8 text-center text-muted-foreground bg-card/40">
                <HelpCircle className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-xs font-medium text-foreground">
                  No questions match your current filter
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 max-w-sm mx-auto">
                  Try adjusting your search terms, select &quot;All Topics&quot;, or ask the
                  maintainers directly on GitHub.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedCategory('all');
                    setSearchQuery('');
                  }}
                  className="mt-3 text-xs h-8 cursor-pointer"
                >
                  Clear search &amp; filters
                </Button>
              </div>
            ) : (
              filteredFaqs.map(faq => {
                const isOpen = openFaqId === faq.id;
                return (
                  <div
                    key={faq.id}
                    className={cn(
                      'overflow-hidden rounded-xl border bg-card transition-all duration-150 shadow-2xs',
                      isOpen
                        ? 'border-primary/40 shadow-xs'
                        : 'border-border/80 hover:border-border'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                      className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-muted/40 cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 pr-3 min-w-0">
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono shrink-0 bg-muted/60 text-muted-foreground border-border/70"
                        >
                          {faq.categoryLabel}
                        </Badge>
                        <span className="text-xs sm:text-sm font-semibold text-foreground truncate sm:whitespace-normal">
                          {faq.question}
                        </span>
                      </div>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                          isOpen ? 'rotate-180 text-foreground' : ''
                        )}
                      />
                    </button>

                    {isOpen && (
                      <div className="border-t border-border/50 px-4 py-3.5 text-xs text-muted-foreground bg-muted/10 leading-relaxed space-y-3 animate-in fade-in-0 duration-150">
                        <p className="text-foreground/90">{faq.answer}</p>
                        <div className="flex items-center justify-between pt-1 border-t border-border/40">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {faq.tags.map(tag => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                          <a
                            href="https://opsknight.com/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline shrink-0 ml-2"
                          >
                            <span>Read in Docs</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      {/* Open Source Community & Maintainer Support Card */}
      <Card className="border-border/80 bg-gradient-to-br from-card via-card to-muted/20 shadow-xs overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between p-6 sm:p-7 gap-6">
          <div className="max-w-xl space-y-2">
            <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
              <Github className="h-4 w-4" />
              <span>Open Source Project</span>
            </div>
            <h3 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Facing challenges or need assistance?
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              OpsKnight is a free and open-source tool. If you encounter bugs, configuration issues,
              or deployment hurdles, you can reach out to the project maintainers on GitHub. The
              maintainers and open-source community can help you out.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 text-xs h-9 border-pink-500/30 hover:border-pink-500/50 hover:bg-pink-500/10 text-foreground transition-all shadow-2xs cursor-pointer"
            >
              <a
                href="https://github.com/sponsors/Dushyant-rahangdale"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Heart className="h-3.5 w-3.5 text-pink-500 fill-pink-500" />
                <span>Sponsor</span>
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="gap-2 text-xs h-9 shadow-2xs cursor-pointer"
            >
              <a
                href="https://github.com/opsknight-labs/OpsKnight/discussions"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-primary" />
                <span>Ask Maintainers</span>
              </a>
            </Button>
            <Button size="sm" asChild className="gap-2 text-xs h-9 shadow-2xs cursor-pointer">
              <a
                href="https://github.com/opsknight-labs/OpsKnight/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                <span>GitHub Issues</span>
              </a>
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
