import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Book, Github, Globe, Mail, ExternalLink, Heart } from 'lucide-react';
import Link from 'next/link';

const resources = [
  {
    href: 'https://opsknight.com/docs',
    title: 'Documentation',
    description: 'In-depth guides, API references, and configuration manuals.',
    icon: Book,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    href: 'https://opsknight.com/',
    title: 'Website',
    description: 'Visit our home page for latest updates and features.',
    icon: Globe,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
  },
  {
    href: 'https://github.com/opsknight-labs/OpsKnight',
    title: 'GitHub Community',
    description: 'Star the project, report issues, or contribute code.',
    icon: Github,
    color: 'text-zinc-900 dark:text-zinc-100',
    bg: 'bg-zinc-900/10 dark:bg-zinc-100/10',
  },
  {
    href: 'https://github.com/sponsors/Dushyant-rahangdale',
    title: 'Sponsor',
    description: 'Support open source development and keep OpsKnight free.',
    icon: Heart,
    color: 'text-pink-500',
    bg: 'bg-pink-500/10',
  },
];

export default function HelpPage() {
  return (
    <main className="max-w-[1200px] mx-auto py-8 container">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Help & Support</h1>
        <p className="text-muted-foreground text-lg">
          Everything you need to get the most out of OpsKnight.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {resources.map(resource => (
          <a
            key={resource.title}
            href={resource.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group block h-full no-underline transition-all duration-200 hover:-translate-y-1"
          >
            <Card className="h-full border-muted/40 transition-shadow hover:shadow-lg dark:hover:shadow-primary/5">
              <CardHeader>
                <div
                  className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors group-hover:bg-opacity-80 rounded-xl ${resource.bg}"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${resource.bg}`}
                  >
                    <resource.icon className={`h-6 w-6 ${resource.color}`} />
                  </div>
                </div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  {resource.title}
                  <ExternalLink className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-50" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base">{resource.description}</CardDescription>
              </CardContent>
            </Card>
          </a>
        ))}
      </div>

      <div className="mt-8">
        <Card className="overflow-hidden border-muted/40 bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-950/20 dark:to-blue-950/20">
          <div className="flex flex-col md:flex-row md:items-center">
            <div className="flex-1 p-6 md:p-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
                  <Mail className="h-5 w-5" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">Still need help?</h2>
              </div>
              <p className="mb-6 max-w-2xl text-muted-foreground">
                Our support team is ready to assist you. Whether you have technical questions,
                feedback, or need account help, reach out to us directly.
              </p>
              <a
                href="mailto:help@opsknight.com"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Mail className="h-4 w-4" />
                Contact Support
              </a>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
