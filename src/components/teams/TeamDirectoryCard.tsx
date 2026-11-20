import Link from 'next/link';
import { AlertTriangle, Users } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { toneClasses } from '@/components/patterns';
import { cn } from '@/lib/utils';

type TeamDirectoryCardProps = {
  team: {
    id: string;
    name: string;
    description?: string | null;
    teamLead?: {
      id: string;
      name: string;
      avatarUrl?: string | null;
      gender?: string | null;
    } | null;
    members: Array<{
      userId: string;
      role: string;
      user: {
        id?: string;
        name: string;
        avatarUrl?: string | null;
        gender?: string | null;
      };
    }>;
    services: Array<{
      id: string;
      name: string;
    }>;
    _count: {
      members: number;
      services: number;
    };
  };
};

const MAX_AVATARS = 4;

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

type TeamLeadInfo = TeamDirectoryCardProps['team']['teamLead'];

/** Lead as avatar + name, or an amber "No lead" warning badge. Shared by the card and table views. */
export function TeamLead({
  lead,
  id,
  className,
}: {
  lead: TeamLeadInfo;
  id?: string;
  className?: string;
}) {
  if (!lead) {
    return (
      <span
        id={id}
        className={cn(
          'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold',
          toneClasses('elevated').soft,
          className
        )}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        No lead
      </span>
    );
  }
  return (
    <span id={id} className={cn('flex min-w-0 items-center gap-1.5 text-xs', className)}>
      <span aria-hidden="true" className="inline-flex">
        <UserAvatar
          userId={lead.id || lead.name}
          avatarUrl={lead.avatarUrl}
          gender={lead.gender}
          name={lead.name}
          size="xs"
          className="h-5 w-5"
          aria-hidden
        />
      </span>
      <span className="truncate font-medium text-foreground">{lead.name}</span>
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Lead
      </span>
    </span>
  );
}

export default function TeamDirectoryCard({ team }: TeamDirectoryCardProps) {
  const nameId = `team-card-${team.id}-name`;
  const detailsId = `team-card-${team.id}-details`;
  const leadId = `team-card-${team.id}-lead`;
  const lead = team.teamLead;
  const visibleMembers = team.members.slice(0, MAX_AVATARS);
  const hiddenMembers = team._count.members - visibleMembers.length;
  const [firstService] = team.services;
  const otherServices = team._count.services - (firstService ? 1 : 0);

  return (
    <Link
      href={`/teams/${team.id}`}
      aria-labelledby={nameId}
      aria-describedby={`${leadId} ${detailsId}`}
      className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 shadow-2xs transition-colors duration-150 hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/* Row 1: identity + lead */}
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20"
        >
          <Users className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p
              id={nameId}
              className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground group-hover:text-primary"
            >
              {team.name}
            </p>
            <TeamLead lead={lead} id={leadId} className="max-w-[45%]" />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {team.description || 'No description'}
          </p>
        </div>
      </div>

      {/* Row 2: roster + coverage */}
      <div id={detailsId} className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {visibleMembers.length > 0 && (
          <span aria-hidden="true" className="flex shrink-0 items-center -space-x-1.5">
            {visibleMembers.map(member => (
              <UserAvatar
                key={member.userId}
                userId={member.user.id || member.userId}
                avatarUrl={member.user.avatarUrl}
                gender={member.user.gender}
                name={member.user.name}
                size="xs"
                className="h-5 w-5 rounded-full ring-2 ring-card"
              />
            ))}
            {hiddenMembers > 0 && (
              <span className="relative inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-2xs font-semibold text-muted-foreground ring-2 ring-card">
                +{hiddenMembers}
              </span>
            )}
          </span>
        )}
        <span className="shrink-0">{plural(team._count.members, 'member')}</span>
        <span aria-hidden="true">·</span>
        <span
          className="flex min-w-0 items-center gap-1"
          title={team.services.map(service => service.name).join(', ') || undefined}
        >
          <span className="shrink-0">
            {plural(team._count.services, 'service')}
            {firstService && ':'}
          </span>
          {firstService && (
            <span className="min-w-0 truncate text-foreground">{firstService.name}</span>
          )}
          {otherServices > 0 && <span className="shrink-0">+{otherServices}</span>}
        </span>
      </div>
    </Link>
  );
}
