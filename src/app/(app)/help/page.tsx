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
} from 'lucide-react';
import { APP_VERSION } from '@/lib/constants';

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
      'Slack App manifest & Socket Mode setup',
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

type FAQItem = {
  question: string;
  category: string;
  answer: string;
  tags: string[];
};

const FAQS: FAQItem[] = [
  {
    question: 'How do incoming alerts route to the correct on-call engineer?',
    category: 'Routing',
    answer:
      'Incoming alerts match a registered Service via API token or webhook route. Each Service is linked to an Escalation Policy. The policy identifies the current on-call engineer based on the active Schedule rotation and begins notifying Tier 1 responders. If unacknowledged within the configured SLA escalation delay, it automatically escalates to Tier 2.',
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
      'When an incident triggers, OpsKnight can automatically generate a dedicated channel in your workspace and post an adaptive card. Any updates made in OpsKnight reflect in the channel in real time. Actions clicked in Teams or Slack (Acknowledge, Resolve, Add Note) verify responder identity and immediately sync back.',
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
    category: 'API & Automation',
    answer:
      'Admins and responders can generate scoped API keys under Settings → API Keys (/settings/api-keys). You can assign granular read/write scopes, set expiration periods, and revoke keys at any moment. Requests to the OpsKnight REST API require an Authorization: Bearer <key> header.',
    tags: ['api', 'tokens', 'scripts', 'automation'],
  },
  {
    question: 'How are postmortems and action items tracked?',
    category: 'Postmortems',
    answer:
      'Once an incident is resolved, responders can initiate a postmortem with an automated timeline of key events. Action items identified during the review can be tracked directly within OpsKnight or synchronized with external issue trackers like Jira to ensure preventative measures are completed.',
    tags: ['postmortem', 'action items', 'jira', 'review'],
  },
];

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

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
    <main className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6 container">
      {/* Hero Header */}
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card to-muted/20 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="max-w-xl">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <HelpCircle className="h-4.5 w-4.5" />
              </div>
              <Badge variant="outline" className="text-xs font-mono font-medium">
                Help & Resources · v{APP_VERSION}
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Help & Documentation
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Architecture documentation, integration guides, operational FAQs, and open-source
              community support for your self-hosted OpsKnight instance.
            </p>

            {/* Quick Actions */}
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
                <a href="https://opsknight.com/docs" target="_blank" rel="noopener noreferrer">
                  <Book className="h-3.5 w-3.5 text-blue-500" />
                  Documentation
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

          {/* System & Diagnostics Navigation Card */}
          <div className="w-full md:w-72 shrink-0 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-border/60">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                System & Diagnostics
              </span>
              <Badge variant="outline" className="text-2xs font-mono text-muted-foreground">
                v{APP_VERSION}
              </Badge>
            </div>

            <div className="space-y-2.5 pt-3 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Public Status</span>
                <Link
                  href="/status"
                  className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  Status Page
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Instance Health</span>
                <Link
                  href="/settings/system/health"
                  className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  Health Checks
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Platform Logs</span>
                <Link
                  href="/system-logs"
                  className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  System Logs
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>

            <Button
              variant="outline"
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

      {/* Documentation Section */}
      <section className="mb-10 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Documentation & Guides
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Technical references for self-hosting, alert ingestion, chatops, and APIs.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="gap-1.5 text-xs h-8 shrink-0">
            <a href="https://opsknight.com/docs" target="_blank" rel="noopener noreferrer">
              <span>View full documentation</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {DOC_TOPICS.map(topic => {
            const Icon = topic.icon;
            return (
              <Card
                key={topic.id}
                className="flex flex-col border-border/70 hover:border-border transition-all duration-150 shadow-2xs group"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between mb-2">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${topic.iconBg} ${topic.iconColor}`}
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
                  <CardTitle className="text-sm font-semibold text-foreground">
                    {topic.title}
                  </CardTitle>
                  <CardDescription className="text-xs leading-relaxed">
                    {topic.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="mt-auto pt-1 pb-4">
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
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
      </section>

      {/* Frequently Asked Questions */}
      <section className="mb-10 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-foreground">
              Frequently Asked Questions
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Common operational solutions for alert routing, deduplication, and war rooms.
            </p>
          </div>
          <div className="w-full sm:w-64">
            <Input
              type="text"
              placeholder="Filter questions…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-8 px-2.5 text-xs bg-card"
            />
          </div>
        </div>

        <div className="space-y-2.5">
          {filteredFaqs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 p-8 text-center text-muted-foreground">
              <p className="text-xs font-medium">No questions match &ldquo;{searchQuery}&rdquo;</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery('')}
                className="mt-2 text-xs h-7"
              >
                Clear filter
              </Button>
            </div>
          ) : (
            filteredFaqs.map((faq, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div
                  key={index}
                  className="overflow-hidden rounded-xl border border-border/70 bg-card transition-all"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="text-xs sm:text-sm font-medium text-foreground pr-3">
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-foreground' : ''
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground bg-muted/10 leading-relaxed space-y-2.5 animate-in fade-in-0 duration-150">
                      <p>{faq.answer}</p>
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        {faq.tags.map(tag => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono text-muted-foreground"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Open Source Community & Maintainer Support */}
      <Card className="border-border/80 bg-gradient-to-br from-card via-card to-muted/20 shadow-xs overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between p-6 sm:p-7 gap-6">
          <div className="max-w-xl space-y-2">
            <div className="flex items-center gap-2 text-primary font-semibold text-xs uppercase tracking-wider">
              <Github className="h-4 w-4" />
              <span>Open Source Tool</span>
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
            <Button variant="outline" size="sm" asChild className="gap-2 text-xs h-9 shadow-2xs">
              <a
                href="https://github.com/opsknight-labs/OpsKnight/discussions"
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-primary" />
                Ask Maintainers
              </a>
            </Button>
            <Button size="sm" asChild className="gap-2 text-xs h-9 shadow-2xs">
              <a
                href="https://github.com/opsknight-labs/OpsKnight/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                GitHub Issues
              </a>
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
