'use client';

import { Book, Github, Globe, Mail, ChevronRight, ExternalLink, Heart } from 'lucide-react';
import { APP_VERSION } from '@/lib/constants';
// MobileHeader is provided by layout

export const dynamic = 'force-dynamic';

export default function MobileHelpPage() {
  const resources = [
    {
      href: 'https://opsknight.com/docs',
      title: 'Documentation',
      subtitle: 'Guides & API Refs',
      icon: Book,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      href: 'https://opsknight.com/',
      title: 'Website',
      subtitle: 'Latest updates',
      icon: Globe,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      href: 'https://github.com/opsknight-labs/OpsKnight',
      title: 'GitHub',
      subtitle: 'Code & Community',
      icon: Github,
      color: 'text-zinc-900 dark:text-zinc-100',
      bg: 'bg-zinc-900/10 dark:bg-zinc-100/10',
    },
    {
      href: 'https://github.com/sponsors/Dushyant-rahangdale',
      title: 'Sponsor',
      subtitle: 'Support the project',
      icon: Heart,
      color: 'text-pink-500',
      bg: 'bg-pink-500/10',
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-4 pb-24">
      <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
        Help & Support
      </h1>

      {/* Resources Section */}
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          Resources
        </h2>
        <div className="overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm">
          {resources.map((item, index) => (
            <a
              key={item.title}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-4 px-4 py-4 active:bg-[color:var(--bg-secondary)] ${
                index !== resources.length - 1 ? 'border-b border-[color:var(--border)]' : ''
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.bg}`}>
                <item.icon className={`h-5 w-5 ${item.color}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-[color:var(--text-primary)]">
                  {item.title}
                  <ExternalLink className="h-3 w-3 opacity-40" />
                </div>
                <div className="text-xs text-[color:var(--text-muted)]">{item.subtitle}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-[color:var(--text-muted)] opacity-50" />
            </a>
          ))}
        </div>
      </section>

      {/* Contact Section */}
      <section className="space-y-3">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          Contact
        </h2>
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] p-5 shadow-sm">
          <div className="mb-4 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400">
              <Mail className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-bold text-[color:var(--text-primary)]">Need Assistance?</h3>
              <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                Our team is here to help with any integration or account issues.
              </p>
            </div>
          </div>
          <a
            href="mailto:help@opsknight.com"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 active:scale-[0.98] transition-all"
          >
            Email Support
          </a>
        </div>
      </section>

      <div className="mt-auto py-6 text-center">
        <p className="text-xs font-medium text-[color:var(--text-muted)]">
          OpsKnight Mobile {APP_VERSION}
        </p>
      </div>
    </div>
  );
}
