import Link from 'next/link';
import { ExternalLink, Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { formatRelativeShort } from '@/lib/mobile-time';
import { formatDateTime } from '@/lib/timezone';
import { loadIncidentCustomerComms, type CustomerCommsPost } from '@/lib/incidents/customer-comms';

/** Posts shown before the "+N earlier" disclosure. */
const SHOWN_POSTS = 3;
const FOCUS = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * "Customer updates": what the status pages told customers about this incident, when the next update
 * is due, and the incident's service as a component on each page. Renders nothing when the read fails.
 */
export default async function IncidentCustomerCommsCard({
  incident,
  timeZone,
}: {
  incident: { id: string; serviceId: string; status: string; visibility: string };
  timeZone?: string;
}) {
  const actor = await getCurrentAuthorizationActor().catch(() => null);
  const view = actor ? await loadIncidentCustomerComms(actor, incident) : null;
  if (!view) return null;

  const shown = view.posts.slice(0, SHOWN_POSTS);
  const earlier = view.posts.slice(SHOWN_POSTS);
  const postRow = (post: CustomerCommsPost) => (
    <PostRow key={post.id} post={post} timeZone={timeZone} />
  );

  return (
    <section className="overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Customer updates
          {view.linked && (
            <span className="font-normal tabular-nums text-muted-foreground">
              {view.posts.length}
              {view.truncated && '+'}
            </span>
          )}
        </h2>
        {view.postHref && (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="-my-1.5 h-7 shrink-0 gap-1 px-2 text-xs font-medium shadow-2xs"
          >
            <Link href={view.postHref}>
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
              Post update
            </Link>
          </Button>
        )}
      </div>

      {!view.linked ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          Not on a status page
          {view.setupHref && (
            <>
              {' · '}
              <Link
                href={view.setupHref}
                className={cn('font-medium text-foreground hover:underline', FOCUS)}
              >
                Set up
              </Link>
            </>
          )}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border/50">
          {view.nextDue && (
            <div className="flex min-h-9 items-center justify-between gap-2 px-3 py-1.5">
              <span
                className={cn(
                  'inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-medium tabular-nums whitespace-nowrap',
                  view.nextDue.overdue
                    ? toneClasses('elevated').soft
                    : 'border-border/80 bg-muted/40 text-muted-foreground'
                )}
                title={`${view.nextDue.pageName}: based on the last update linked to this incident`}
              >
                {view.nextDue.text}
              </span>
            </div>
          )}

          {view.posts.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No updates posted yet</p>
          )}
          {shown.map(postRow)}
          {earlier.length > 0 && (
            <details className="group">
              <summary
                className={cn(
                  'flex cursor-pointer list-none items-center px-3 py-1.5 text-2xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground [&::-webkit-details-marker]:hidden',
                  FOCUS
                )}
              >
                <span className="group-open:hidden">
                  +{earlier.length}
                  {view.truncated && '+'} earlier
                </span>
                <span className="hidden group-open:inline">Show fewer</span>
              </summary>
              <div className="flex flex-col divide-y divide-border/50 border-t border-border/50">
                {earlier.map(postRow)}
              </div>
            </details>
          )}

          {view.components.length > 0 && (
            <div className="px-3 py-2">
              <p className="mb-1 text-2xs font-medium text-muted-foreground">Affected components</p>
              <ul className="flex flex-col gap-1">
                {view.components.map(component => (
                  <li key={component.key} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                      {component.name}
                      <span className="text-muted-foreground"> · {component.pageName}</span>
                    </span>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium',
                        toneClasses(component.tone).soft
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          toneClasses(component.tone).solid
                        )}
                        aria-hidden
                      />
                      {component.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PostRow({ post, timeZone }: { post: CustomerCommsPost; timeZone?: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="shrink-0 font-medium text-foreground">{post.kind}</span>
        {post.lifecycle && (
          <span className="shrink-0 rounded border border-border/80 bg-muted/40 px-1 leading-4">
            {post.lifecycle}
          </span>
        )}
        <span aria-hidden>·</span>
        {post.href ? (
          <a
            href={post.href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('inline-flex min-w-0 items-center gap-0.5 hover:text-foreground', FOCUS)}
            title={`Open ${post.pageName}`}
          >
            <span className="truncate">{post.pageName}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="truncate">{post.pageName}</span>
        )}
        <time
          dateTime={post.at}
          title={timeZone ? formatDateTime(post.at, timeZone) : post.at}
          className="ml-auto shrink-0 tabular-nums"
        >
          {formatRelativeShort(post.at, timeZone)}
        </time>
      </div>
      {/* Clamped in the row; hovering or focusing it shows the whole update. */}
      <HoverCard openDelay={200} closeDelay={100}>
        <HoverCardTrigger asChild>
          <div tabIndex={0} className={cn('mt-0.5 min-w-0 cursor-default rounded-sm', FOCUS)}>
            <p className="truncate text-xs font-medium text-foreground">{post.title}</p>
            {post.firstLine && (
              <p className="truncate text-2xs text-muted-foreground">{post.firstLine}</p>
            )}
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          align="start"
          side="left"
          className="w-96 max-w-[calc(100vw-2rem)] space-y-2 p-3"
        >
          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">{post.kind}</span>
            {post.lifecycle && (
              <span className="rounded border border-border/80 bg-muted/40 px-1 leading-4">
                {post.lifecycle}
              </span>
            )}
            <span aria-hidden>·</span>
            <span>{post.pageName}</span>
            <span aria-hidden>·</span>
            <time dateTime={post.at}>
              {timeZone ? formatDateTime(post.at, timeZone, { format: 'datetime' }) : post.at}
            </time>
          </div>
          <p className="text-sm font-semibold leading-snug text-foreground">{post.title}</p>
          {post.message && (
            <p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
              {post.message}
            </p>
          )}
          {post.href && (
            <a
              href={post.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open {post.pageName}
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}
