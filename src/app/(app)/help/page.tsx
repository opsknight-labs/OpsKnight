'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
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
  Globe,
  Mail,
  ExternalLink,
  Heart,
  HelpCircle,
  CheckCircle2,
  Activity,
  ShieldCheck,
  MessageSquare,
  Calendar,
  Copy,
  Check,
  ChevronDown,
  Sparkles,
  ArrowRight,
  FileText,
  Flame,
  Radio,
} from 'lucide-react';
import { APP_VERSION } from '@/lib/constants';

type GuideTopic = {
  id: string;
  title: string;
  category:
    | 'Incident Management'
    | 'Schedules & Routing'
    | 'ChatOps & Integrations'
    | 'Security & Compliance';
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  href?: string;
  isExternal?: boolean;
  highlights: string[];
};

const GUIDES: GuideTopic[] = [
  {
    id: 'incident-triage',
    title: 'Incident Lifecycle & Triage',
    category: 'Incident Management',
    description:
      'Learn how alerts trigger incidents, how responders acknowledge, escalate, and author incident postmortems.',
    icon: Flame,
    iconBg: 'bg-rose-500/10 dark:bg-rose-500/20',
    iconColor: 'text-rose-600 dark:text-rose-400',
    href: '/incidents',
    highlights: [
      'Severity escalation (P1–P4)',
      'Incident Commander assignment',
      'Postmortem action items',
    ],
  },
  {
    id: 'schedules-escalations',
    title: 'On-Call Schedules & Escalation Policies',
    category: 'Schedules & Routing',
    description:
      'Design multi-tier escalation paths, daily/weekly on-call rotations, holiday overrides, and notification rules.',
    icon: Calendar,
    iconBg: 'bg-blue-500/10 dark:bg-blue-500/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    href: '/schedules',
    highlights: [
      'Multi-tier fallback escalation',
      'Custom rotation layers',
      'Temporary coverage overrides',
    ],
  },
  {
    id: 'chatops-collaboration',
    title: 'ChatOps: Slack & Microsoft Teams',
    category: 'ChatOps & Integrations',
    description:
      'Enable automated incident war rooms, bidirectional card actions, stakeholder broadcasts, and mobile paging.',
    icon: MessageSquare,
    iconBg: 'bg-purple-500/10 dark:bg-purple-500/20',
    iconColor: 'text-purple-600 dark:text-purple-400',
    href: '/settings/slack',
    highlights: [
      'Automatic channel generation',
      'One-click Acknowledge & Resolve',
      'War room lifecycle sync',
    ],
  },
  {
    id: 'inbound-webhooks',
    title: 'Alerting Webhooks & Integrations',
    category: 'ChatOps & Integrations',
    description:
      'Connect Prometheus Alertmanager, Datadog, AWS CloudWatch, Grafana, and custom webhook payloads.',
    icon: Radio,
    iconBg: 'bg-amber-500/10 dark:bg-amber-500/20',
    iconColor: 'text-amber-600 dark:text-amber-400',
    href: '/services',
    highlights: ['JSON payload routing rules', 'Deduplication keys', 'Rate limiting & failover'],
  },
  {
    id: 'sso-rbac',
    title: 'SSO, SCIM & Access Management',
    category: 'Security & Compliance',
    description:
      'Configure enterprise single sign-on (SAML 2.0 / OIDC), Okta, Entra ID, SCIM provisioning, and role mapping.',
    icon: ShieldCheck,
    iconBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    href: '/settings/security',
    highlights: [
      'OIDC & SAML 2.0 auth',
      'Role-based access control (RBAC)',
      'Active Directory / Entra auto-sync',
    ],
  },
  {
    id: 'compliance-audit',
    title: 'Audit Logs & Privacy Control Center',
    category: 'Security & Compliance',
    description:
      'Inspect cryptographic tamper-evident audit trails, generate compliance reports, and execute GDPR/CCPA requests.',
    icon: FileText,
    iconBg: 'bg-teal-500/10 dark:bg-teal-500/20',
    iconColor: 'text-teal-600 dark:text-teal-400',
    href: '/audit',
    highlights: [
      'Immutable tamper-evident trails',
      'GDPR / CCPA data subject requests',
      'Security drift monitoring',
    ],
  },
];

type FAQItem = {
  question: string;
  category: string;
  answer: string;
  tags: string[];
};

const FAQS: FAQItem[] = [
  {
    question: 'How do alerts route to the correct on-call engineer?',
    category: 'Routing',
    answer:
      'Incoming alerts match a registered Service via API token or webhook route. Each Service is linked to an Escalation Policy. The policy identifies the current on-call engineer based on the active Schedule rotation and begins notifying Tier 1 responders. If unacknowledged within the configured SLA escalation delay (e.g. 5 minutes), it automatically escalates to Tier 2.',
    tags: ['alerts', 'routing', 'escalation', 'sla'],
  },
  {
    question: 'How does alert deduplication prevent notification storms?',
    category: 'Alerting',
    answer:
      'OpsKnight extracts or computes a dedup_key from incoming alert payloads. When multiple alerts share the same deduplication key and the incident is already OPEN or ACKNOWLEDGED, OpsKnight appends the subsequent alerts to the existing incident timeline instead of creating duplicate incidents or dispatching duplicate pages.',
    tags: ['deduplication', 'grouping', 'alerts', 'noise'],
  },
  {
    question: 'How do Slack and Microsoft Teams war rooms sync?',
    category: 'ChatOps',
    answer:
      'When an incident triggers, OpsKnight can automatically generate a dedicated channel (e.g. #inc-104-api-outage) in your workspace and post an adaptive card. Any updates made in OpsKnight (status change, timeline note, severity bump) reflect in the channel in real time. Actions clicked in Teams or Slack (Acknowledge, Resolve, Add Note) verify identity and immediately sync back.',
    tags: ['slack', 'teams', 'war rooms', 'chatops'],
  },
  {
    question: 'What happens during a shift override if the substitute is unavailable?',
    category: 'Schedules',
    answer:
      'If an on-call substitute does not acknowledge the incident within the escalation window, the Escalation Policy automatically progresses to the next escalation tier (such as secondary on-call, team lead, or backup schedule), ensuring no incident is ever dropped.',
    tags: ['override', 'schedules', 'fallback', 'escalation'],
  },
  {
    question: 'How do I generate an API key for CI/CD or custom monitoring scripts?',
    category: 'API & Integrations',
    answer:
      'Admins and responders can generate scoped API keys under Settings → API Keys (/settings/api-keys). You can assign granular read/write scopes, set expiration periods, and revoke keys at any moment. Requests to the OpsKnight REST API require an Authorization: Bearer <key> header.',
    tags: ['api', 'tokens', 'scripts', 'automation'],
  },
  {
    question: 'Where can I export incident records or postmortem action items to Jira?',
    category: 'Incident Management',
    answer:
      'Navigate to Action Items (/action-items). Each action item created from an incident postmortem can be synced directly to Jira projects. You can map Jira issue types, track issue keys, and maintain bidirectional status updates.',
    tags: ['jira', 'action items', 'postmortem', 'export'],
  },
];

const COMMUNITY_RESOURCES = [
  {
    href: 'https://opsknight.com/docs',
    title: 'Official Documentation',
    description:
      'Complete architecture references, REST API contracts, and self-hosting deployment manuals.',
    icon: Book,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    href: 'https://github.com/opsknight-labs/OpsKnight',
    title: 'GitHub Community & Issues',
    description:
      'Star the repository, track release notes, submit bug reports, and contribute to the codebase.',
    icon: Github,
    color: 'text-zinc-900 dark:text-zinc-100',
    bg: 'bg-zinc-900/10 dark:bg-zinc-100/10',
  },
  {
    href: 'https://opsknight.com/',
    title: 'OpsKnight Portal',
    description:
      'Explore platform roadmaps, product feature releases, enterprise architecture, and news.',
    icon: Globe,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  {
    href: 'https://github.com/sponsors/Dushyant-rahangdale',
    title: 'Sponsor Development',
    description:
      'Support continuous open-source incident management development and sustainable maintenance.',
    icon: Heart,
    color: 'text-pink-500',
    bg: 'bg-pink-500/10',
  },
];

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [copiedEmail, setCopiedEmail] = useState(false);

  const categories = [
    'All',
    'Incident Management',
    'Schedules & Routing',
    'ChatOps & Integrations',
    'Security & Compliance',
  ];

  const handleCopyEmail = () => {
    navigator.clipboard.writeText('help@opsknight.com');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const filteredGuides = useMemo(() => {
    return GUIDES.filter(guide => {
      const matchesCategory = activeCategory === 'All' || guide.category === activeCategory;
      if (!matchesCategory) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        guide.title.toLowerCase().includes(q) ||
        guide.description.toLowerCase().includes(q) ||
        guide.category.toLowerCase().includes(q) ||
        guide.highlights.some(h => h.toLowerCase().includes(q))
      );
    });
  }, [activeCategory, searchQuery]);

  const filteredFaqs = useMemo(() => {
    if (!searchQuery.trim()) return FAQS;
    const q = searchQuery.toLowerCase().trim();
    return FAQS.filter(
      faq =>
        faq.question.toLowerCase().includes(q) ||
        faq.answer.toLowerCase().includes(q) ||
        faq.tags.some(t => t.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  return (
    <main className="max-w-[1200px] mx-auto py-8 px-4 sm:px-6 container">
      {/* Hero Header */}
      <div className="relative mb-10 overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-muted/20 p-6 sm:p-10 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <HelpCircle className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-mono font-medium">
                Support & Guides &middot; {APP_VERSION}
              </Badge>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Help & Operations Support
            </h1>
            <p className="mt-2 text-base text-muted-foreground leading-relaxed">
              Playbooks, configuration manuals, troubleshooting answers, and diagnostic channels to
              keep your incident operations running without interruption.
            </p>

            {/* Quick Actions Row */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-xs h-8 shadow-2xs"
                onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Shortcuts (<kbd className="font-mono text-[10px]">?</kbd>)
              </Button>
              <Button variant="outline" size="sm" asChild className="gap-2 text-xs h-8 shadow-2xs">
                <Link href="/status">
                  <Activity className="h-3.5 w-3.5 text-emerald-500" />
                  System Status
                </Link>
              </Button>
              <Button variant="outline" size="sm" asChild className="gap-2 text-xs h-8 shadow-2xs">
                <a href="https://opsknight.com/docs" target="_blank" rel="noopener noreferrer">
                  <Book className="h-3.5 w-3.5 text-blue-500" />
                  Full Docs
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild className="gap-2 text-xs h-8 shadow-2xs">
                <a
                  href="https://github.com/opsknight-labs/OpsKnight"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="h-3.5 w-3.5" />
                  GitHub Repo
                </a>
              </Button>
            </div>
          </div>

          {/* Quick Diagnostics Snapshot Card */}
          <div className="w-full md:w-72 shrink-0 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                System Health
              </span>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Operational
                </span>
              </div>
            </div>

            <div className="space-y-2.5 pt-3 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Core Engine</span>
                <span className="font-medium text-foreground">Online</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Webhook Ingestion</span>
                <span className="font-medium text-foreground">Healthy</span>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>App Version</span>
                <span className="font-mono font-medium text-foreground">{APP_VERSION}</span>
              </div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              asChild
              className="w-full mt-3 justify-center text-xs h-8"
            >
              <Link href="/status">
                View status dashboard
                <ArrowRight className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Search & Topic Filter Bar */}
      <div className="mb-8 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border/70 bg-card/60">
          <div className="flex-1 max-w-lg">
            <Input
              type="text"
              placeholder="Search guides, topics, questions, or keywords…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-9 px-3 text-xs bg-background"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
            {categories.map(category => {
              const active = activeCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-all ${
                    active
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Operations Guides Grid */}
      <section className="mb-12 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Core Operations Playbooks
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Detailed step-by-step guides for mastering incident response and reliability
              workflows.
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {filteredGuides.length} guides
          </Badge>
        </div>

        {filteredGuides.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-12 text-center text-muted-foreground">
            <Book className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm font-medium">No guides match your search</p>
            <p className="text-xs text-muted-foreground/80 mt-1">
              Try adjusting your query or resetting category filters.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setActiveCategory('All');
              }}
              className="mt-3 text-xs h-8"
            >
              Reset filters
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {filteredGuides.map(guide => {
              const Icon = guide.icon;
              return (
                <Card
                  key={guide.id}
                  className="flex flex-col border-border/70 hover:border-border transition-all duration-150 hover:shadow-sm group"
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between mb-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl ${guide.iconBg} ${guide.iconColor} transition-transform group-hover:scale-105`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="secondary" className="text-[10px] font-medium">
                        {guide.category}
                      </Badge>
                    </div>
                    <CardTitle className="text-base font-semibold group-hover:text-primary transition-colors">
                      {guide.title}
                    </CardTitle>
                    <CardDescription className="text-xs leading-relaxed line-clamp-3">
                      {guide.description}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="mt-auto pt-0 space-y-4">
                    <div className="space-y-1.5 pt-2 border-t border-border/40">
                      {guide.highlights.map((highlight, hIdx) => (
                        <div
                          key={hIdx}
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                        >
                          <CheckCircle2 className="h-3 w-3 text-primary/70 shrink-0" />
                          <span className="truncate">{highlight}</span>
                        </div>
                      ))}
                    </div>

                    {guide.href && (
                      <Button
                        variant="outline"
                        size="sm"
                        asChild
                        className="w-full justify-between text-xs h-8 group/btn"
                      >
                        <Link href={guide.href}>
                          <span>Explore section</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground group-hover/btn:translate-x-0.5 transition-transform" />
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Troubleshooting & FAQs Accordion */}
      <section className="mb-12 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Frequently Asked Questions & Troubleshooting
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Common solutions for alert routing, deduplication, notifications, and war rooms.
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">
            {filteredFaqs.length} answers
          </Badge>
        </div>

        <div className="space-y-3">
          {filteredFaqs.map((faq, index) => {
            const isOpen = openFaqIndex === index;
            return (
              <div
                key={index}
                className="overflow-hidden rounded-xl border border-border/70 bg-card transition-all"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="flex items-center gap-3 pr-4">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground text-xs font-mono">
                      Q
                    </div>
                    <span className="text-sm font-semibold text-foreground">{faq.question}</span>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-foreground' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-border/50 px-5 py-4 text-xs sm:text-sm text-muted-foreground bg-muted/10 leading-relaxed space-y-3 animate-in fade-in-0 duration-150">
                    <p>{faq.answer}</p>
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      {faq.tags.map(tag => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-mono text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* External Resources & Community */}
      <section className="mb-12 space-y-4">
        <h2 className="text-xl font-bold tracking-tight text-foreground">
          Community & Technical Resources
        </h2>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {COMMUNITY_RESOURCES.map(res => {
            const Icon = res.icon;
            return (
              <a
                key={res.title}
                href={res.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group block no-underline transition-all duration-150 hover:-translate-y-0.5"
              >
                <Card className="h-full border-border/70 group-hover:border-border transition-colors shadow-2xs">
                  <CardHeader className="p-4 pb-2">
                    <div className="flex items-center justify-between mb-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl ${res.bg}`}
                      >
                        <Icon className={`h-5 w-5 ${res.color}`} />
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <CardTitle className="text-sm font-semibold group-hover:text-primary transition-colors">
                      {res.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-1">
                    <CardDescription className="text-xs leading-relaxed">
                      {res.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      </section>

      {/* Contact & Support Section */}
      <Card className="border-border/80 bg-gradient-to-br from-card via-card to-primary/5 shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between p-6 sm:p-8 gap-6">
          <div className="max-w-xl space-y-2">
            <div className="flex items-center gap-2 text-primary font-semibold text-sm">
              <Mail className="h-4 w-4" />
              <span>Direct Technical Support</span>
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">
              Still have questions or running into an issue?
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Our engineering team is on standby to assist with integration inquiries, custom
              webhook payloads, SSO configuration, or self-hosted deployment architecture.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyEmail}
              className="gap-2 text-xs h-10"
            >
              {copiedEmail ? (
                <>
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span>Copied help@opsknight.com</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-muted-foreground" />
                  <span>Copy support email</span>
                </>
              )}
            </Button>

            <Button asChild size="sm" className="gap-2 text-xs h-10 shadow-xs">
              <a href="mailto:help@opsknight.com?subject=OpsKnight%20Support%20Request">
                <Mail className="h-4 w-4" />
                Email Support
              </a>
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
