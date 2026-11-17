'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { EmptyState, PageHeader } from '@/components/patterns';
import { pageHeaderActionClass, pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
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
  Keyboard,
} from 'lucide-react';
import { APP_VERSION } from '@/lib/constants';
import { cn } from '@/lib/utils';

type DocTopic = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
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

/** The help centre; `mcpEntry` is rendered by the server page only while MCP is in force. */
export default function HelpCenter({ mcpEntry }: { mcpEntry?: React.ReactNode }) {
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
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        title="Help Center"
        icon={HelpCircle}
        description="Documentation, self-hosting guides, answers to common questions and how to reach the maintainers."
        badges={<span className={cn(pageHeaderBadgeClass, 'font-mono')}>{APP_VERSION}</span>}
        secondaryActions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
              className={cn('gap-2', pageHeaderActionClass)}
            >
              <Keyboard className="h-4 w-4" aria-hidden="true" />
              Keyboard shortcuts
              <kbd className="rounded border border-zinc-600 px-1 font-mono text-2xs">?</kbd>
            </Button>
            <Button
              variant="outline"
              size="sm"
              asChild
              className={cn('gap-2', pageHeaderActionClass)}
            >
              <a
                href="https://github.com/sponsors/Dushyant-rahangdale"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Heart className="h-4 w-4" aria-hidden="true" />
                Sponsor
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
          </>
        }
        primaryAction={
          <Button size="sm" asChild className="gap-2">
            <a href="https://opsknight.com/docs" target="_blank" rel="noopener noreferrer">
              <Book className="h-4 w-4" aria-hidden="true" />
              Documentation
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        }
      />

      {mcpEntry}

      {/* Main Grid: Documentation Guides (Left 8 cols) + System Diagnostics (Right 4 cols) */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Documentation & Platform Diagnostics
            </h2>
            <p className="text-sm text-muted-foreground">
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
                <Card key={topic.id} className="flex flex-col">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </div>
                      <a
                        href={topic.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span>Docs</span>
                        <span className="sr-only">: {topic.title} (opens in a new tab)</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                    <CardTitle className="text-sm font-semibold text-foreground">
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
                          <CheckCircle2
                            className="h-3 w-3 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
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
          <Card className="flex flex-col justify-between lg:col-span-4">
            <div>
              <CardHeader className="p-5 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                    <Activity className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <Badge variant="outline" className="text-2xs font-mono text-muted-foreground">
                    {APP_VERSION}
                  </Badge>
                </div>
                <CardTitle className="text-base font-semibold text-foreground">
                  System & Diagnostics
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  Health checks, system logs and the public status page.
                </CardDescription>
              </CardHeader>

              <CardContent className="p-5 pt-0">
                <div className="space-y-3 pt-2 border-t border-border/60 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground py-1">
                    <span>Public status</span>
                    <Link
                      href="/status"
                      className="flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Status page
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  </div>

                  {isAdmin ? (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Instance health</span>
                        <Link
                          href="/settings/system/health"
                          className="flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Health checks
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Platform logs</span>
                        <Link
                          href="/system-logs"
                          className="flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          System logs
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground py-1 border-t border-border/40">
                        <span>Keyboard shortcuts</span>
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))
                          }
                          className="flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Show sheet
                          <kbd className="rounded border border-border bg-muted px-1 font-mono text-2xs">
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
                          className="flex items-center gap-1 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          Online docs
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Frequently Asked Questions
          </h2>
          <p className="text-sm text-muted-foreground">
            Curated answers organized by category, with search and troubleshooting guides.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* FAQ Sidebar (3 cols on large screens) */}
          <div className="space-y-4 lg:col-span-4 xl:col-span-3">
            {/* Search Box */}
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                aria-label="Search frequently asked questions"
                placeholder="Search FAQs…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="h-9 bg-card pl-9 pr-8 text-sm [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  data-icon-button
                  className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Category Navigation */}
            <div
              role="group"
              aria-labelledby="faq-categories-label"
              className="space-y-1 rounded-lg border border-border bg-card p-1.5 shadow-sm"
            >
              <div
                id="faq-categories-label"
                className="px-2.5 py-1 text-xs font-medium text-muted-foreground"
              >
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
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedCategory(category.id);
                      const firstMatch =
                        category.id === 'all'
                          ? FAQS[0]
                          : FAQS.find(f => f.categoryId === category.id);
                      if (firstMatch) setOpenFaqId(firstMatch.id);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    )}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon
                        aria-hidden="true"
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isSelected ? 'text-primary-foreground' : 'text-muted-foreground'
                        )}
                      />
                      <span className="truncate">{category.label}</span>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'ml-2 h-5 shrink-0 border-0 px-1.5 py-0 text-2xs tabular-nums',
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
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>Can&apos;t find an answer?</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Connect with the open-source maintainers on GitHub Discussions for troubleshooting
                help.
              </p>
              <a
                href="https://github.com/opsknight-labs/OpsKnight/discussions"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm pt-1 text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>Ask the maintainers</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </div>
          </div>

          {/* FAQ Content Area (9 cols on large screens) */}
          <div className="space-y-3 lg:col-span-8 xl:col-span-9">
            {/* Header info bar */}
            <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span aria-live="polite">
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
                  className="rounded-sm text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Reset filters
                </button>
              )}
            </div>

            {filteredFaqs.length === 0 ? (
              <EmptyState
                icon={<HelpCircle />}
                title="No questions match your search"
                description="Try other words, pick All topics, or ask the maintainers on GitHub."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedCategory('all');
                      setSearchQuery('');
                    }}
                  >
                    Clear search and filters
                  </Button>
                }
              />
            ) : (
              filteredFaqs.map(faq => {
                const isOpen = openFaqId === faq.id;
                return (
                  <div
                    key={faq.id}
                    className={cn(
                      'overflow-hidden rounded-lg border bg-card shadow-sm transition-colors duration-150',
                      isOpen ? 'border-ink-300' : 'border-border'
                    )}
                  >
                    <h3>
                      <button
                        type="button"
                        id={`${faq.id}-trigger`}
                        aria-expanded={isOpen}
                        aria-controls={`${faq.id}-panel`}
                        onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                        className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex items-center gap-2.5 pr-3 min-w-0">
                          <Badge
                            variant="outline"
                            className="hidden shrink-0 border-border bg-muted/60 text-2xs text-muted-foreground sm:inline-flex"
                          >
                            {faq.categoryLabel}
                          </Badge>
                          <span className="text-xs sm:text-sm font-semibold text-foreground truncate sm:whitespace-normal">
                            {faq.question}
                          </span>
                        </div>
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                            isOpen ? 'rotate-180 text-foreground' : ''
                          )}
                        />
                      </button>
                    </h3>

                    {isOpen && (
                      <div
                        id={`${faq.id}-panel`}
                        role="region"
                        aria-labelledby={`${faq.id}-trigger`}
                        className="space-y-3 border-t border-border bg-muted/10 px-4 py-3.5 text-sm leading-relaxed text-muted-foreground"
                      >
                        <p className="max-w-prose text-foreground">{faq.answer}</p>
                        <div className="flex items-center justify-between pt-1 border-t border-border/40">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {faq.tags.map(tag => (
                              <span
                                key={tag}
                                className="rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                          <a
                            href="https://opsknight.com/docs"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span>Read in docs</span>
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            <span className="sr-only">(opens in a new tab)</span>
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
      <Card className="overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between p-6 sm:p-7 gap-6">
          <div className="max-w-xl space-y-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
              <Github className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              Need help from the maintainers?
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              OpsKnight is a free and open-source tool. If you encounter bugs, configuration issues,
              or deployment hurdles, you can reach out to the project maintainers on GitHub. The
              maintainers and open-source community can help you out.
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 shrink-0">
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a
                href="https://github.com/sponsors/Dushyant-rahangdale"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Heart className="h-4 w-4" aria-hidden="true" />
                <span>Sponsor</span>
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a
                href="https://github.com/opsknight-labs/OpsKnight/discussions"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span>Ask the maintainers</span>
              </a>
            </Button>
            <Button size="sm" asChild className="gap-2">
              <a
                href="https://github.com/opsknight-labs/OpsKnight/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <span>GitHub Issues</span>
              </a>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
