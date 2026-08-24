import prisma from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MobileIncidentActions from './actions';
import { MobileAvatar } from '@/components/mobile/MobileUtils';
import { getDefaultAvatar } from '@/lib/avatar';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import MobileTime from '@/components/mobile/MobileTime';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Clock,
  User,
  Zap,
  FileText,
  MessageSquare,
  Tag,
  Eye,
  Activity,
  CheckCircle2,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ id: string }>;
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: 'bg-red-50 text-red-700 dark:bg-red-900/10 dark:text-red-400 border-red-200 dark:border-red-900/20',
  ACKNOWLEDGED:
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  RESOLVED:
    'bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400 border-slate-200 dark:border-slate-800',
  SNOOZED:
    'bg-slate-50 text-slate-500 dark:bg-slate-900/30 dark:text-slate-500 border-slate-100 dark:border-slate-800',
  SUPPRESSED:
    'bg-slate-50 text-slate-400 dark:bg-slate-900/20 dark:text-slate-600 border-slate-100 dark:border-slate-800',
};

const URGENCY_STYLES: Record<string, string> = {
  HIGH: 'bg-red-50 text-red-700 dark:bg-red-900/10 dark:text-red-400',
  MEDIUM: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  LOW: 'bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-400',
};

const STATUS_GRADIENT: Record<string, string> = {
  OPEN: 'from-red-600 to-red-500',
  ACKNOWLEDGED: 'from-slate-600 to-slate-500',
  RESOLVED: 'from-slate-600 to-slate-500',
  SNOOZED: 'from-slate-500 to-slate-400',
  SUPPRESSED: 'from-slate-400 to-slate-300',
  DEFAULT: 'from-slate-800 to-slate-700',
};

export default async function MobileIncidentDetailPage({ params }: PageProps) {
  const { id } = await params;
  const authOptions = await getAuthOptions();
  const session = await getServerSession(authOptions);
  const currentUserId = session?.user?.id || null;

  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      service: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true, email: true, avatarUrl: true, gender: true } },
      team: { select: { id: true, name: true } },
      events: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
          },
        },
      },
      watchers: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarUrl: true, gender: true },
          },
        },
      },
      tags: {
        include: { tag: { select: { id: true, name: true, color: true } } },
      },
      postmortem: { select: { id: true, status: true } },
    },
  });

  if (!incident) {
    notFound();
  }

  const serviceName = incident.service?.name ?? 'Unknown service';

  const [users, teams] = await Promise.all([
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Back Button */}
      <Link
        href="/m/incidents"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors w-fit"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Incidents
      </Link>

      {/* Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm">
        {/* Status Gradient Bar */}
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${STATUS_GRADIENT[incident.status] || STATUS_GRADIENT.OPEN}`}
        />

        <div className="p-4 pt-5">
          {/* Status & Urgency Badges */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span
              className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide border ${STATUS_STYLES[incident.status] || STATUS_STYLES.OPEN}`}
            >
              {incident.status}
            </span>
            {incident.urgency && (
              <span
                className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${URGENCY_STYLES[incident.urgency] || URGENCY_STYLES.LOW}`}
              >
                {incident.urgency}
              </span>
            )}
          </div>

          {/* Title */}
          <h1 className="text-lg font-bold text-[color:var(--text-primary)] leading-snug mb-2">
            {incident.title}
          </h1>

          {/* Meta Info */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[color:var(--text-muted)]">
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              {serviceName}
            </span>
            <span className="text-[color:var(--text-disabled)]">•</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <MobileTime value={incident.createdAt} format="short" />
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <MobileIncidentActions
        incidentId={incident.id}
        status={incident.status}
        urgency={incident.urgency}
        assigneeId={incident.assigneeId}
        currentUserId={currentUserId}
        users={users}
        teams={teams}
      />

      {/* Details Card */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)]">
          <h3 className="text-sm font-bold text-[color:var(--text-primary)] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[color:var(--text-muted)]" />
            Details
          </h3>
        </div>
        <div className="divide-y divide-[color:var(--border)]">
          <DetailRow icon={<Zap className="h-4 w-4" />} label="Service" value={serviceName} />
          <DetailRow
            icon={
              incident.assignee ? (
                <div className="-ml-0.5">
                  <MobileAvatar
                    name={incident.assignee.name || incident.assignee.email}
                    size="sm"
                    src={
                      incident.assignee.avatarUrl ||
                      getDefaultAvatar(incident.assignee.gender, incident.assignee.id)
                    }
                  />
                </div>
              ) : (
                <User className="h-4 w-4" />
              )
            }
            label="Assigned To"
            value={incident.assignee?.name || incident.team?.name || 'Unassigned'}
            subValue={incident.team && !incident.assignee ? '(Team)' : undefined}
          />
          <DetailRow
            icon={<Clock className="h-4 w-4" />}
            label="Created"
            value={<MobileTime value={incident.createdAt} format="short" />}
          />
          {incident.acknowledgedAt && (
            <DetailRow
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Acknowledged"
              value={<MobileTime value={incident.acknowledgedAt} format="short" />}
            />
          )}
          {incident.resolvedAt && (
            <DetailRow
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Resolved"
              value={<MobileTime value={incident.resolvedAt} format="short" />}
            />
          )}
        </div>
      </div>

      {/* Description */}
      {/* Description */}
      {incident.description && (
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)]">
            <h3 className="text-sm font-bold text-[color:var(--text-primary)] flex items-center gap-2">
              <FileText className="h-4 w-4 text-[color:var(--text-muted)]" />
              Description
            </h3>
          </div>
          <div className="p-4">
            <p className="text-sm text-[color:var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
              {incident.description}
            </p>
          </div>
        </div>
      )}

      {/* Timeline / Events */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)]">
          <h3 className="text-sm font-bold text-[color:var(--text-primary)] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[color:var(--text-muted)]" />
            Recent Activity
          </h3>
        </div>
        <div className="p-4">
          {incident.events.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] text-center py-4">
              No activity yet
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {incident.events.map(event => (
                <div key={event.id} className="pl-4 border-l-2 border-[color:var(--border)]">
                  <div className="text-sm font-medium text-[color:var(--text-primary)]">
                    {event.message}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)] mt-0.5">
                    <MobileTime value={event.createdAt} format="relative-short" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      {incident.tags.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)]">
            <h3 className="text-sm font-bold text-[color:var(--text-primary)] flex items-center gap-2">
              <Tag className="h-4 w-4 text-[color:var(--text-muted)]" />
              Tags
            </h3>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-2">
              {incident.tags.map(({ tag }) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium"
                  style={{
                    backgroundColor: tag.color ? `${tag.color}20` : undefined,
                    color: tag.color || undefined,
                    border: `1px solid ${tag.color || '#e5e7eb'}40`,
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Watchers */}
      {incident.watchers.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)]">
            <h3 className="text-sm font-bold text-[color:var(--text-primary)] flex items-center gap-2">
              <Eye className="h-4 w-4 text-[color:var(--text-muted)]" />
              Watchers ({incident.watchers.length})
            </h3>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-2">
              {incident.watchers.map(w => (
                <span
                  key={w.id}
                  className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-[color:var(--bg-secondary)] text-[color:var(--text-secondary)]"
                >
                  {w.user.name || w.user.email}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {incident.notes.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-secondary)]">
            <h3 className="text-sm font-bold text-[color:var(--text-primary)] flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[color:var(--text-muted)]" />
              Notes ({incident.notes.length})
            </h3>
          </div>
          <div className="p-4">
            <div className="flex flex-col gap-4">
              {incident.notes.map(n => (
                <div key={n.id} className="pl-4 border-l-2 border-primary/50">
                  <div className="text-sm text-[color:var(--text-secondary)] leading-relaxed">
                    {n.content}
                  </div>
                  <div className="text-xs text-[color:var(--text-muted)] mt-1">
                    {n.user?.name || n.user?.email || 'Deleted user'} •{' '}
                    <MobileTime value={n.createdAt} format="relative-short" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Postmortem Link */}
      {incident.status === 'RESOLVED' && incident.postmortem && (
        <Link
          href={`/m/postmortems/${incident.postmortem.id}`}
          className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4 text-emerald-700 dark:text-emerald-400 font-semibold text-sm transition-all active:scale-[0.98]"
        >
          <FileText className="h-4 w-4" />
          View Postmortem ({incident.postmortem.status})
        </Link>
      )}
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  subValue,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  subValue?: string;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
        {icon}
        {label}
      </span>
      <div className="text-right">
        <span className="text-sm font-medium text-[color:var(--text-primary)]">{value}</span>
        {subValue && (
          <span className="block text-xs text-[color:var(--text-muted)]">{subValue}</span>
        )}
      </div>
    </div>
  );
}
