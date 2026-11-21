'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  BarChart,
  BookOpen,
  Calendar,
  CalendarClock,
  FilePlus,
  FileText,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  Loader2,
  Monitor,
  Moon,
  PieChart,
  Plus,
  Search as SearchIcon,
  Server,
  Shield,
  Sparkles,
  Sun,
  User,
  Users,
  Wrench,
  Zap,
  Check,
  type LucideIcon,
} from 'lucide-react';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/shadcn/command';
import { DialogOverlay, DialogPortal } from '@/components/ui/shadcn/dialog';
import UserAvatar from '@/components/UserAvatar';
import PaletteKnowledgeResults from '@/components/search/PaletteKnowledgeResults';
import { openSquire } from '@/components/squire/squire-bus';
import {
  queryAddressesAssistant,
  questionFromPaletteQuery,
} from '@/components/squire/palette-question';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { useThemePreference } from '@/hooks/use-theme-preference';
import { GLOBAL_NAVIGATION_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import type { ThemeChoice } from '@/lib/theme-preference';
import {
  groupResults,
  pushRecent,
  rankCommands,
  readRecents,
  type EntityType,
  type PaletteCommand,
  type SearchResult,
} from './palette-model';
import { MIN_SEARCH_LENGTH, useEntitySearch } from './use-entity-search';

type Entry = PaletteCommand & { icon: LucideIcon };

const goShortcut = (href: string) => {
  const key = GLOBAL_NAVIGATION_SHORTCUTS.find(item => item.href === href)?.key;
  return key ? ['G', key.toUpperCase()] : undefined;
};

const nav = (
  id: string,
  title: string,
  subtitle: string,
  href: string,
  icon: LucideIcon,
  keywords: string[]
): Entry => ({
  id,
  group: 'navigate',
  title,
  subtitle,
  href,
  icon,
  keywords,
  shortcut: goShortcut(href),
});

const NAVIGATE: Entry[] = [
  nav('nav-dashboard', 'Dashboard', 'System overview & metrics', '/', LayoutDashboard, [
    'overview',
    'home',
    'main',
    'summary',
  ]),
  nav('nav-incidents', 'Incidents', 'Active & resolved incidents', '/incidents', Zap, [
    'incident',
    'alerts',
    'outages',
    'issues',
    'tickets',
  ]),
  nav('nav-services', 'Services', 'Service registry & status', '/services', Server, [
    'service',
    'components',
    'microservices',
    'infrastructure',
    'endpoints',
  ]),
  nav('nav-schedules', 'Schedules', 'On-call shifts & rotations', '/schedules', Calendar, [
    'schedule',
    'oncall',
    'on-call',
    'shifts',
    'rotations',
    'calendar',
    'handoff',
  ]),
  nav(
    'nav-policies',
    'Escalation Policies',
    'Alert routing & escalation tiers',
    '/policies',
    Shield,
    ['policy', 'escalation', 'routing', 'rules', 'tiers']
  ),
  nav('nav-teams', 'Teams', 'Team directory & rosters', '/teams', Users, [
    'team',
    'groups',
    'squads',
    'members',
  ]),
  nav('nav-users', 'Users', 'User directory & access roles', '/users', User, [
    'user',
    'people',
    'responders',
    'accounts',
    'members',
    'directory',
  ]),
  nav(
    'nav-runbooks',
    'Runbooks',
    'Automated and manual response procedures',
    '/runbooks',
    BookOpen,
    ['runbook', 'automation', 'playbooks', 'procedures']
  ),
  nav('nav-analytics', 'Analytics', 'MTTA, MTTR & SLA compliance trends', '/insights', PieChart, [
    'metrics',
    'mtta',
    'mttr',
    'sla',
    'trends',
    'insights',
    'uptime',
  ]),
  nav(
    'nav-reports',
    'Reports & Dashboards',
    'Executive reports & reliability widgets',
    '/reports',
    BarChart,
    ['report', 'dashboards', 'executive', 'reliability']
  ),
  nav(
    'nav-postmortems',
    'Postmortems',
    'Root cause analysis & lessons learned',
    '/postmortems',
    FileText,
    ['postmortem', 'rca', 'retrospectives', 'lessons', 'incident reports']
  ),
  nav(
    'nav-action-items',
    'Action Items',
    'Post-incident corrective actions',
    '/action-items',
    ListTodo,
    ['action item', 'tasks', 'remediation', 'todos', 'followups']
  ),
  nav('nav-settings', 'Settings', 'Integrations, API keys & preferences', '/settings', Wrench, [
    'setting',
    'configuration',
    'integrations',
    'api keys',
    'slack',
    'profile',
  ]),
];

const action = (
  id: string,
  title: string,
  subtitle: string,
  icon: LucideIcon,
  keywords: string[],
  extra: Partial<Entry> = {}
): Entry => ({ id, group: 'actions', title, subtitle, icon, keywords, ...extra });

const ACTIONS: Entry[] = [
  action('create-incident', 'Create incident', 'Declare a new incident', Zap, [
    'new incident',
    'declare',
    'trigger',
    'page',
    'create',
  ]),
  action(
    'create-service',
    'Create service',
    'Opens Services to add one',
    Plus,
    ['new service', 'add', 'create'],
    {
      href: '/services',
    }
  ),
  action(
    'create-team',
    'Create team',
    'Opens Teams to add one',
    Plus,
    ['new team', 'add', 'create'],
    {
      href: '/teams',
    }
  ),
  action(
    'create-schedule',
    'Create schedule',
    'Opens Schedules to add one',
    Plus,
    ['new schedule', 'rotation', 'add', 'create'],
    {
      href: '/schedules',
    }
  ),
  action(
    'create-postmortem',
    'Create postmortem',
    'Write up an incident',
    FilePlus,
    ['new postmortem', 'rca', 'create'],
    {
      href: '/postmortems/create',
    }
  ),
  action(
    'my-on-call',
    'Go to my on-call',
    'Schedules and current shifts',
    CalendarClock,
    ['oncall', 'on-call', 'shift', 'who is on call', 'rotation'],
    {
      href: '/schedules',
    }
  ),
  action(
    'keyboard-shortcuts',
    'Open keyboard shortcuts',
    'Every shortcut in one list',
    Keyboard,
    ['help', 'hotkeys', 'keys', 'keyboard'],
    {
      shortcut: ['?'],
    }
  ),
];

const THEME_SOURCES: ReadonlyArray<{ choice: ThemeChoice; title: string; icon: LucideIcon }> = [
  { choice: 'dark', title: 'Switch to dark theme', icon: Moon },
  { choice: 'light', title: 'Switch to light theme', icon: Sun },
  { choice: 'system', title: 'Match system theme', icon: Monitor },
];

const THEME_ACTIONS: Array<Entry & { choice: ThemeChoice }> = THEME_SOURCES.map(
  ({ choice, title, icon }) =>
    Object.assign(
      action(`theme-${choice}`, title, 'Appearance', icon, [
        'theme',
        'appearance',
        'mode',
        'color',
        choice,
      ]),
      { choice }
    )
);

/** Shown under the "no results" message so the next step is one keystroke away. */
const SUGGESTION_IDS = ['create-incident', 'nav-incidents', 'nav-services', 'keyboard-shortcuts'];

const ENTITY_ICONS: Record<EntityType, LucideIcon> = {
  incident: Zap,
  service: Server,
  team: Users,
  user: User,
  schedule: Calendar,
  runbook: BookOpen,
  policy: Shield,
  postmortem: FileText,
};

const ITEM_CLASS = 'min-h-10 gap-3 cursor-pointer';

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-2xs font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

function ItemText({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate font-medium text-foreground">{title}</span>
      {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
    </span>
  );
}

function EntityItem({ result, onSelect }: { result: SearchResult; onSelect: () => void }) {
  const Icon = ENTITY_ICONS[result.type];
  return (
    <CommandItem
      value={`${result.type}:${result.id}`}
      data-href={result.href}
      onSelect={onSelect}
      className={ITEM_CLASS}
    >
      {result.type === 'user' ? (
        <UserAvatar
          userId={result.id}
          avatarUrl={result.avatarUrl}
          name={result.title}
          size="sm"
          aria-hidden
        />
      ) : (
        <Icon aria-hidden="true" />
      )}
      <ItemText title={result.title} subtitle={result.subtitle} />
    </CommandItem>
  );
}

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element that gets focus back on close (the topbar trigger). */
  returnFocusTo: RefObject<HTMLElement | null>;
  modKey: string;
};

export default function CommandPalette({
  open,
  onOpenChange,
  returnFocusTo,
  modKey,
}: CommandPaletteProps) {
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();
  const theme = useThemePreference();
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<SearchResult[]>(() => readRecents());
  const restoreFocus = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const { results, loading, failed } = useEntitySearch(open ? query : '');

  const commands = useMemo<Entry[]>(
    () => [...ACTIONS, ...(theme.locked ? [] : THEME_ACTIONS), ...NAVIGATE],
    [theme.locked]
  );
  const hasQuery = query.trim().length > 0;
  const ranked = useMemo(() => rankCommands(commands, query), [commands, query]);
  const actions = ranked.filter(command => command.group === 'actions');
  const navigate = ranked.filter(command => command.group === 'navigate');
  const groups = groupResults(results);
  const waitingForEntities = loading && query.trim().length >= MIN_SEARCH_LENGTH;
  const noResults = hasQuery && !waitingForEntities && ranked.length === 0 && results.length === 0;

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery('');
  }, [onOpenChange]);

  // The assistant announces itself when mounted, so the entry only exists while it is switched on.
  const [assistantName, setAssistantName] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setAssistantName(document.documentElement.dataset.squireName ?? null);
    read();
    window.addEventListener('squire:ready', read);
    return () => window.removeEventListener('squire:ready', read);
  }, []);
  const assistantMatches =
    hasQuery && Boolean(assistantName) && queryAddressesAssistant(query, assistantName ?? '');
  const assistantQuestion = assistantName
    ? questionFromPaletteQuery(query, assistantName)
    : undefined;

  const askAssistant = () => {
    // The assistant panel takes focus itself; the typed question goes with it so it is not typed twice.
    restoreFocus.current = false;
    close();
    openSquire(assistantQuestion);
  };

  const openHref = (href: string) => {
    close();
    router.push(href);
  };

  const openEntity = (result: SearchResult) => {
    setRecents(pushRecent(result));
    close();
    router.push(result.href);
  };

  const runCommand = (command: Entry) => {
    if (command.href) {
      close();
      router.push(command.href);
      return;
    }
    if (command.id.startsWith('theme-')) {
      close();
      theme.setChoice(command.id.slice('theme-'.length) as ThemeChoice);
      return;
    }
    // These open another dialog that takes focus itself; don't pull it back to the trigger.
    restoreFocus.current = false;
    close();
    if (command.id === 'create-incident') openCreateIncident();
    else if (command.id === 'keyboard-shortcuts')
      window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'));
  };

  // ⌘/Ctrl+Enter opens the highlighted link in a new tab instead of navigating.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    const selected = rootRef.current?.querySelector<HTMLElement>(
      '[cmdk-item][data-selected="true"]'
    );
    const href = selected?.dataset.href;
    if (!href) return;
    event.preventDefault();
    const entity = [...results, ...recents].find(item => item.href === href);
    if (entity) setRecents(pushRecent(entity));
    window.open(href, '_blank', 'noopener');
  };

  const renderCommand = (command: Entry) => {
    const Icon = command.icon;
    const themeActive = 'choice' in command && theme.choice === command.choice;
    return (
      <CommandItem
        key={command.id}
        value={command.id}
        data-href={command.href}
        onSelect={() => runCommand(command)}
        className={ITEM_CLASS}
      >
        <Icon aria-hidden="true" />
        <ItemText title={command.title} subtitle={command.subtitle} />
        {themeActive && <Check aria-label="Current theme" />}
        {command.shortcut && (
          <CommandShortcut className="flex gap-1" aria-hidden="true">
            {command.shortcut.map(key => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </CommandShortcut>
        )}
      </CommandItem>
    );
  };

  const statusMessage = waitingForEntities
    ? 'Searching'
    : noResults
      ? 'No results'
      : hasQuery
        ? `${ranked.length + results.length} results`
        : '';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => (next ? onOpenChange(true) : close())}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (restoreFocus.current) returnFocusTo.current?.focus();
            restoreFocus.current = true;
          }}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search incidents, services, people and more, or run an action. Use the arrow keys to
            move and Enter to open.
          </DialogPrimitive.Description>
          <Command
            ref={rootRef}
            label="Command palette"
            shouldFilter={false}
            loop
            onKeyDown={handleKeyDown}
            className="rounded-none bg-transparent"
          >
            <div className="relative">
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search or type a command…"
                wrapperClassName="h-12"
                className="pr-16 text-base sm:text-sm"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                {waitingForEntities && (
                  <Loader2
                    className="h-4 w-4 animate-spin text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <Kbd>esc</Kbd>
              </span>
            </div>
            <div className="sr-only" aria-live="polite" role="status">
              {statusMessage}
            </div>

            <CommandList className="max-h-[min(60vh,28rem)] py-1">
              {!hasQuery && recents.length > 0 && (
                <CommandGroup heading="Recent">
                  {recents.map(recent => (
                    <EntityItem
                      key={`${recent.type}:${recent.id}`}
                      result={recent}
                      onSelect={() => openEntity(recent)}
                    />
                  ))}
                </CommandGroup>
              )}

              {assistantMatches && assistantName && (
                <CommandGroup heading="Assistant">
                  <CommandItem
                    value={`ask-${assistantName}`}
                    onSelect={askAssistant}
                    className={ITEM_CLASS}
                  >
                    <Sparkles
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <ItemText
                      title={`Ask ${assistantName}`}
                      subtitle={assistantQuestion ?? 'Questions about incidents you can access'}
                    />
                  </CommandItem>
                </CommandGroup>
              )}

              {actions.length > 0 && (
                <CommandGroup heading="Actions">{actions.map(renderCommand)}</CommandGroup>
              )}
              {navigate.length > 0 && (
                <CommandGroup heading="Navigate">{navigate.map(renderCommand)}</CommandGroup>
              )}

              {groups.map(group => (
                <CommandGroup key={group.type} heading={group.label}>
                  {group.items.map(result => (
                    <EntityItem
                      key={`${result.type}:${result.id}`}
                      result={result}
                      onSelect={() => openEntity(result)}
                    />
                  ))}
                </CommandGroup>
              ))}

              {hasQuery && <PaletteKnowledgeResults query={query} onOpen={openHref} />}

              {waitingForEntities && ranked.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Searching…
                </div>
              )}

              {failed && (
                <p className="px-4 py-3 text-xs text-muted-foreground">
                  Search is unavailable right now. Pages and actions still work.
                </p>
              )}

              {noResults && (
                <>
                  <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
                    <SearchIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium text-foreground">
                      No results for &ldquo;{query.trim()}&rdquo;
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Try an incident title or ID, a service, a person&rsquo;s name or email.
                    </p>
                  </div>
                  <CommandGroup heading="Suggestions">
                    {commands
                      .filter(command => SUGGESTION_IDS.includes(command.id))
                      .map(renderCommand)}
                  </CommandGroup>
                </>
              )}
            </CommandList>

            <div className="hidden items-center gap-4 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:flex">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>{modKey}</Kbd>
                <Kbd>↵</Kbd> new tab
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Kbd>{modKey}</Kbd>
                <Kbd>K</Kbd> toggle
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
