'use client';

import { parseSquireOpenDetail, subscribeSquireOpen } from './squire-bus';
export { openSquire } from './squire-bus';
import { usePathname } from 'next/navigation';
import { useOptionalRealtime } from '@/hooks/useRealtime';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { ArrowDown, Search, Trash2 } from 'lucide-react';
import SquireAvatar from '@/components/squire/SquireAvatar';
import SquireMessage from './SquireMessage';
import { squirePresence, type AiAvailability } from './presence';
import { Button } from '@/components/ui/shadcn/button';
import type { StoredTurnEnvelope } from '@/lib/intelligence/conversations/contract';
import type { SquireProposalView } from './SquireProposalCard';

import {
  mergeChart,
  mergeInvestigationStep,
  parseTrace,
  type Turn,
  type Citation,
} from './chat-types';
import {
  describeSquireContext,
  incidentIdFromPath,
  pageContextFromPath,
  type SquirePageKind,
} from './page-context';
import { createDeltaBatcher, type DeltaBatcher } from './delta-batcher';
import { trapTabKey } from './focus-trap';
import SquireAvailabilityNotice, {
  retryAfterUntil,
  squireAvailabilityState,
  type SquireRateLimit,
} from './SquireAvailabilityNotice';
import { DOCK_PANEL_CLASS, DOCK_WRAPPER_CLASS } from './dock';
import SquireBarCompanion from './SquireBarCompanion';
import { useSquireSurfaces } from './use-squire-surfaces';
import SquirePinnedBriefing from './SquirePinnedBriefing';
import { SquireEvidenceChip } from './SquireSurfaceControls';
import SquireHeader from './SquireHeader';
import SquireEmptyState from './SquireEmptyState';
import SquireComposer, { type SquireMention } from './SquireComposer';
import { buildNotes, nextNoteAt } from './squire-messages';
import {
  emptyHeadline,
  emptyTip,
  pendingLine,
  presenceLabel,
  shortcutLabel,
  type Tone,
} from './squire-voice';
import { matchSlashCommands, type SlashCommand } from './slash-commands';
import type { StatusBarShift } from '@/lib/status-bar';
import { toneClasses } from '@/components/patterns/status-tone';
import { incidentRef } from '@/lib/intelligence/incident-ux/explain';
import SquireBackgroundAnswers from './SquireBackgroundAnswers';
import {
  CONVERSATION_PARAM,
  readConversationLink,
  useSquireBackground,
  type BackgroundTurn,
} from './background-turns';
type SavedConversation = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  incidentId?: string | null;
};
const CONVERSATIONS_URL = '/api/intelligence/squire/conversations';

const HISTORY_TURNS = 10;
const STALL_MS = 45_000;
// A tab hidden this long counts as left: a running investigation then moves to the background.
const HIDDEN_HANDOFF_MS = 30_000;
/** The open conversation, per tab, so a reload continues it instead of starting over. */
const CONVERSATION_KEY = 'opsknight.squire.conversation';
const MAX_LENGTH = 2000;
/** The server keeps this much of each earlier turn as context; sending more only wastes the request. */
const HISTORY_TURN_LENGTH = 4000;
const SUGGESTIONS = [
  'What is on fire?',
  'Catch me up',
  'My open incidents',
  'How many incidents this week?',
  'List services',
  'Help',
];
const INCIDENT_SUGGESTIONS = [
  'Similar incidents?',
  'What could have caused this?',
  'Which runbook fits?',
  'Who is assigned to this incident?',
];
/** Questions about the page the person is on; each one is a follow-up basic mode already answers. */
const PAGE_SUGGESTIONS: Partial<Record<SquirePageKind, { title: string; items: string[] }>> = {
  service: {
    title: 'For this service',
    items: [
      'Who is on call for it?',
      'Open incidents for this service',
      'Recent changes for this service',
      'Runbooks for this service',
    ],
  },
  schedule: { title: 'For this schedule', items: ['Who is on call?', 'Who is on call tomorrow?'] },
};
const NO_SHIFTS: StatusBarShift[] = [];
/** setTimeout's ceiling; a later on-call note re-arms the timer when it fires. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const SIDE_KEY = 'opsknight.squire.side';

type Side = 'right' | 'left';
const SIDE_EVENT = 'squire:side';
const readSide = (): Side => {
  try {
    return window.localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right';
  } catch {
    return 'right';
  }
};
const subscribeSide = (onChange: () => void) => {
  window.addEventListener(SIDE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SIDE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
};
// The server cannot know the user's choice, so it always renders the default side.
const serverSide = (): Side => 'right';
const onlineSnapshot = () => navigator.onLine;
const serverOnline = () => true;
const subscribeOnline = (change: () => void) => {
  window.addEventListener('online', change);
  window.addEventListener('offline', change);
  return () => {
    window.removeEventListener('online', change);
    window.removeEventListener('offline', change);
  };
};

// The incident or entity page the person is on (desktop and mobile routes), so "this incident",
// "this service" or "this team" mean something to the assistant.
const incidentIdFrom = incidentIdFromPath;
const pageContextFrom = pageContextFromPath;

function readStoredConversation(): string | null {
  try {
    return window.sessionStorage.getItem(CONVERSATION_KEY);
  } catch {
    return null;
  }
}

function storeConversation(id: string | undefined) {
  try {
    if (id) window.sessionStorage.setItem(CONVERSATION_KEY, id);
    else window.sessionStorage.removeItem(CONVERSATION_KEY);
  } catch {
    // Storage can be disabled; a reload then starts a new conversation, as before.
  }
}

/** The page context of the user turn before `index`, or undefined when there is none. */
function previousContext(turns: Turn[], index: number): string | undefined {
  return turns.slice(0, index).findLast(turn => turn.role === 'user' && turn.context)?.context;
}

/** "Now on incident #ABCDE" style marker shown where the conversation moved to another page. */
export function contextDividerLabel(context: string): string {
  if (context === 'general') return 'Now a general question';
  const [kind, id = ''] = context.split(':');
  if (kind === 'incident') return `Now on incident ${incidentRef(id)}`;
  return `Now on this ${kind.replace('_', ' ')}`;
}

/**
 * What the polite live region reads out. An investigation announces the step it is on, then each lookup
 * inside that step; a plain answer announces its lookups, then that text is arriving.
 */
function progressAnnouncement(busy: boolean, turn: Turn | undefined, hasTurns: boolean): string {
  if (!busy) return hasTurns ? 'Answer complete' : '';
  const running = turn?.investigation?.find(step => step.status === 'running');
  const step = running ? `Step ${running.index}: ${running.title}` : '';
  if (turn?.activity) return `${step ? `${step}. ` : ''}${turn.activity}…`;
  if (turn?.content) return 'Writing a response';
  return step ? `${step}…` : 'Response in progress';
}

export default function SquireLauncher({
  name,
  launcher = 'FLOATING',
  animated = false,
  aiEnabled = false,
  history = null,
  fullscreen = false,
  canManageAi = false,
  pinBriefing = false,
  shifts = NO_SHIFTS,
  userName = null,
}: {
  name: string;
  launcher?: 'FLOATING' | 'SEARCH_ONLY';
  animated?: boolean;
  aiEnabled?: boolean;
  /** Set when an administrator has turned on saved conversations. */
  history?: { retentionDays: number } | null;
  /** Mobile pages: the open chat fills the screen at every width; the button clears the bottom bar. */
  fullscreen?: boolean;
  /** The person may change AI settings; limit and disabled notices then link to them. */
  canManageAi?: boolean;
  /** Pin the incident briefing above a conversation about an incident (loaded from the briefing API). */
  pinBriefing?: boolean;
  /** The person's upcoming on-call shifts (from the status bar), for heads-ups in Squire's speech bubble. */
  shifts?: StatusBarShift[];
  /** For a friendlier greeting; only the first name is used. */
  userName?: string | null;
}) {
  const pathname = usePathname();
  const realtime = useOptionalRealtime();
  const { userTimeZone } = useTimezone();
  const side = useSyncExternalStore(subscribeSide, readSide, serverSide);
  const sendRef = useRef<(message: string, replayFrom?: number, retry?: boolean) => Promise<void>>(
    async () => undefined
  );
  const incidentId = incidentIdFrom(pathname);
  const pageContext = useMemo(
    () => (incidentId ? undefined : pageContextFrom(pathname)),
    [incidentId, pathname]
  );
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [mentions, setMentions] = useState<SquireMention[]>([]);
  const [busy, setBusy] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, serverOnline);
  const [expanded, setExpanded] = useState(false);
  const [greeting, setGreeting] = useState(true);
  const [availability, setAvailability] = useState<AiAvailability>(
    aiEnabled ? 'ready' : 'disabled'
  );
  const [rateLimit, setRateLimit] = useState<SquireRateLimit | null>(null);
  // Why a setting keeps AI out; shown once in the banner instead of on every answer.
  const [policyReason, setPolicyReason] = useState<string | null>(null);
  const [attention, setAttention] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [unread, setUnread] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const turnsRef = useRef(turns);
  const nextTurnId = useRef(0);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  useEffect(() => {
    if (!open || !greeting) return;
    const timer = window.setTimeout(() => setGreeting(false), 2500);
    return () => window.clearTimeout(timer);
  }, [open, greeting]);
  useEffect(() => {
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j' && !event.altKey) {
        event.preventDefault();
        // Holding the keys down must not flicker the dialog open and closed.
        if (event.repeat) return;
        setOpen(value => !value);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);
  const [actionOutcome, setActionOutcome] = useState<'success' | 'error' | null>(null);
  useEffect(() => {
    if (!actionOutcome) return;
    const timer = window.setTimeout(() => setActionOutcome(null), 2400);
    return () => window.clearTimeout(timer);
  }, [actionOutcome]);
  // A helpful rating: a short salute, without the "action completed" line a real action gets.
  const [cheer, setCheer] = useState(false);
  useEffect(() => {
    if (!cheer) return;
    const timer = window.setTimeout(() => setCheer(false), 1600);
    return () => window.clearTimeout(timer);
  }, [cheer]);
  // Picks the playful lines once per mount, so they do not change on every render.
  const [seed] = useState(() => Math.floor(Math.random() * 1000));
  const lastTurn = turns.at(-1);
  // The conversation follows the person across pages; each turn records the page it was asked on.
  const scopeId = incidentId;
  const contextKey = incidentId
    ? `incident:${incidentId}`
    : pageContext
      ? `${pageContext.kind}:${pageContext.id}`
      : 'general';
  const currentIncident = scopeId
    ? realtime?.recentIncidents.find(row => row.id === scopeId)
    : null;
  const incidentAttention = realtime?.isRevoked
    ? false
    : currentIncident
      ? currentIncident.status === 'OPEN' && currentIncident.urgency === 'HIGH'
      : scopeId
        ? attention
        : Boolean(
            realtime?.recentIncidents.some(row => row.status === 'OPEN' && row.urgency === 'HIGH')
          );
  // Playful when calm; plain words while a high-urgency incident needs attention.
  const tone: Tone = incidentAttention ? 'crisp' : 'calm';
  const presence = squirePresence({
    online,
    greeting: greeting && turns.length === 0,
    busy,
    speaking: Boolean(lastTurn?.content && !lastTurn.activity),
    typing: Boolean(input.trim()),
    failed: Boolean(lastTurn?.failed),
    outcome: actionOutcome ?? (cheer ? 'success' : null),
    attention: incidentAttention,
    availability,
  });
  const mascotState = presence.state;
  const basicModeLabel =
    rateLimit && availability === 'quota'
      ? 'Basic mode · AI rate limited'
      : availability === 'quota'
        ? 'Basic mode · AI limit reached'
        : availability === 'unavailable'
          ? 'Basic mode · AI unavailable'
          : availability === 'disabled'
            ? 'Basic mode · AI disabled'
            : null;
  const statusLabel =
    online && basicModeLabel && (mascotState === 'offline' || mascotState === 'idle')
      ? basicModeLabel
      : presenceLabel(mascotState, presence.label, tone);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [showHistory, setShowHistory] = useState(false);
  const [saved, setSaved] = useState<SavedConversation[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Each request gets a number; a stream that is no longer the latest (new chat, opened conversation)
  // cannot write into what is on screen now.
  const requestSeq = useRef(0);
  // Each saved-chat load gets a number too, so a slow response cannot replace a newer one.
  const openSeq = useRef(0);
  const pendingRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  /** Where focus was before the dialog opened, so closing puts the person back where they were. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Streamed text of the answer in progress, applied once per animation frame. */
  const deltasRef = useRef<DeltaBatcher | null>(null);
  const wasOpen = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  /** The request of the answer in progress, so it can be handed to the background. */
  const liveRequestRef = useRef<Record<string, unknown> | null>(null);
  const handingOffRef = useRef(false);
  const [handOffError, setHandOffError] = useState('');
  // Read before the deep-link hook below tidies the address bar; never rendered, so no hydration concern.
  const [linkedConversation] = useState(() =>
    typeof window === 'undefined' ? null : readConversationLink(window.location.search)
  );
  const background = useSquireBackground({ enabled: Boolean(history), open });

  // Closing only hides the panel: an answer in progress keeps arriving and is there when it is reopened.
  const close = useCallback(() => setOpen(false), []);
  // An answer that finished while the panel was closed; Squire brings the news in his speech bubble.
  const [answerReady, setAnswerReady] = useState<number | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  if (open && answerReady !== null) setAnswerReady(null);
  // Re-evaluate on-call notes exactly when one becomes due, never by polling.
  const [clock, setClock] = useState(() => Date.now());
  const noteDueAt = nextNoteAt(shifts, clock);
  useEffect(() => {
    if (noteDueAt === null) return;
    const delay = Math.min(Math.max(noteDueAt - Date.now(), 0) + 250, MAX_TIMEOUT_MS);
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [noteDueAt]);
  const openPanel = useCallback(() => setOpen(true), []);
  // Docked display, hand-off evidence and the ?squire=open deep link live in their own hook.
  const surfaces = useSquireSurfaces({
    pathname,
    incidentId,
    open,
    fullscreen,
    onOpen: openPanel,
    onPrefill: setInput,
  });
  const { dock, receive: receiveHandOff, clearEvidence } = surfaces;

  useEffect(() => {
    document.documentElement.dataset.squireName = name;
    window.dispatchEvent(new Event('squire:ready'));
    return () => {
      delete document.documentElement.dataset.squireName;
      window.dispatchEvent(new Event('squire:ready'));
    };
  }, [name]);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setOpen(true);
      const request = parseSquireOpenDetail((event as CustomEvent<unknown>).detail);
      receiveHandOff(request);
      if (request.message) void sendRef.current(request.message.slice(0, MAX_LENGTH));
    };
    return subscribeSquireOpen(onOpen);
  }, [receiveHandOff]);

  const switchSide = useCallback(() => {
    try {
      window.localStorage.setItem(SIDE_KEY, readSide() === 'right' ? 'left' : 'right');
    } catch {
      // Storage can be disabled; the launcher then stays on its default side.
    }
    window.dispatchEvent(new Event(SIDE_EVENT));
  }, []);

  useEffect(
    () => () => {
      deltasRef.current?.cancel();
      abortRef.current?.abort();
    },
    []
  );
  useEffect(() => {
    // Remember the last focused element outside the dialog: the launcher, a page control, or the field
    // the global shortcut was pressed in.
    const remember = (event: FocusEvent) => {
      const target = event.target;
      // The header's More menu is portalled outside the dialog but belongs to it.
      if (
        target instanceof HTMLElement &&
        !dialogRef.current?.contains(target) &&
        !target.closest('[role="menu"]')
      )
        returnFocusRef.current = target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) {
      // Closing returns focus to where it was (or the launcher) so keyboard users are not left at the
      // top of the page. The floating launcher is re-created on close, so a stale reference falls back.
      const previous = returnFocusRef.current;
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else launcherRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, busy]);
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }
  }, [input]);

  const send = useCallback(
    /** `replayFrom` with `retry`: answer the same question again in this conversation; without: an edit. */
    async (raw: string, replayFrom?: number, retry = false) => {
      const message = raw.trim().slice(0, MAX_LENGTH);
      if (!message || !online) return;
      if (busy) {
        // Asked while an answer is still arriving (for example from another part of the page): send it next.
        pendingRef.current = message;
        return;
      }
      const priorTurns = replayFrom === undefined ? turns : turns.slice(0, replayFrom);
      // Only an edited question starts a new version of the chat; a retry stays in this one.
      const fork = replayFrom !== undefined && !retry;
      const history = priorTurns
        .filter(turn => turn.content && !turn.failed)
        .slice(-HISTORY_TURNS)
        .map(({ role, content, contextProof }) => ({
          role,
          content: content.slice(0, HISTORY_TURN_LENGTH),
          ...(contextProof ? { contextProof } : {}),
        }));
      const exchange = ++nextTurnId.current;
      setTurns([
        ...priorTurns,
        {
          id: `live-${exchange}-user`,
          role: 'user',
          content: message,
          incidentId,
          context: contextKey,
        },
        {
          id: `live-${exchange}-assistant`,
          role: 'assistant',
          content: '',
          incidentId,
          context: contextKey,
          ...(fork ? { notice: 'This is a new version. Existing saved chats are unchanged.' } : {}),
        },
      ]);
      if (fork) setConversationId(undefined);
      setEditIndex(null);
      setShowHistory(false);
      setActionOutcome(null);
      atBottomRef.current = true;
      setUnread(false);
      setInput('');
      // Mentions go with the question they were picked for (new or edited); a retry leaves them for the next.
      const sentMentions = retry ? [] : mentions;
      if (!retry) setMentions([]);
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      let stalled = false;
      let stallTimer: number | undefined;
      const seq = ++requestSeq.current;
      const patchNow = (update: (turn: Turn) => Turn) => {
        if (seq !== requestSeq.current) return;
        if (!atBottomRef.current) setUnread(true);
        setTurns(current =>
          current.map((turn, index) => (index === current.length - 1 ? update(turn) : turn))
        );
      };
      // Text deltas are joined per animation frame: one render (and one markdown parse) per frame
      // instead of one per token. Every other update first applies the queued text, so order is kept.
      deltasRef.current?.cancel();
      const deltas = createDeltaBatcher(text =>
        patchNow(turn => ({ ...turn, content: turn.content + text, activity: undefined }))
      );
      deltasRef.current = deltas;
      const patch = (update: (turn: Turn) => Turn) => {
        deltas.flush();
        patchNow(update);
      };
      try {
        const payload = {
          message,
          history,
          ...(incidentId ? { incidentId } : {}),
          ...(pageContext ? { pageContext } : {}),
          ...(sentMentions.length
            ? { mentions: sentMentions.map(({ kind, id }) => ({ kind, id })) }
            : {}),
          ...(conversationId && !fork ? { conversationId } : {}),
          // Only the latest answer can be retried; its new answer replaces that saved exchange.
          ...(retry ? { replaceLastExchange: true } : {}),
        };
        // Bound the serialized UTF-8 request, including integrity proofs and multibyte text.
        while (
          payload.history.length &&
          new TextEncoder().encode(JSON.stringify(payload)).byteLength > 60_000
        )
          payload.history.shift();
        liveRequestRef.current = payload;
        setHandOffError('');
        const response = await fetch('/api/intelligence/squire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (seq === requestSeq.current) {
          if (response.status === 429)
            setRateLimit({
              until: retryAfterUntil(response.headers?.get?.('retry-after') ?? null),
            });
          else if (response.ok) setRateLimit(null);
        }
        if (!response.ok || !response.body) {
          patch(turn => ({
            ...turn,
            failed: true,
            content:
              response.status === 401
                ? 'Please sign in again.'
                : response.status === 429
                  ? 'Too many requests. Wait a moment, then retry.'
                  : response.status === 403
                    ? 'You do not have permission to use this assistant.'
                    : 'I could not answer that. Please try again.',
          }));
          // A request limit is only an AI limit when AI is on; in basic mode the status stays truthful.
          if (response.status === 429 && aiEnabled) setAvailability('quota');
          return;
        }
        const reader = response.body.getReader();
        // The server pings while it works; this long without a byte means the answer stalled.
        const armStall = () => {
          window.clearTimeout(stallTimer);
          stallTimer = window.setTimeout(() => {
            stalled = true;
            controller.abort();
          }, STALL_MS);
        };
        armStall();
        const decoder = new TextDecoder();
        let buffer = '';
        let completed = false;
        let reportedError = false;
        const processLine = (raw: string) => {
          const line = raw.trim();
          if (!line) return;
          let event: {
            type: string;
            text?: string;
            message?: string;
            label?: string;
            mode?: 'ai' | 'basic';
            intent?: string;
            availability?: AiAvailability;
            reason?: string;
            limit?: 'rate' | 'budget';
            attention?: boolean;
            id?: string;
            userProof?: string;
            assistantProof?: string;
            proposal?: SquireProposalView;
            items?: unknown[];
            step?: unknown;
            chart?: unknown;
            trace?: unknown;
          };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (seq !== requestSeq.current) return;
          if (
            event.availability &&
            ['ready', 'disabled', 'quota', 'unavailable'].includes(event.availability)
          ) {
            setAvailability(event.availability);
            setPolicyReason(typeof event.reason === 'string' ? event.reason.slice(0, 200) : null);
            if (event.availability === 'quota' && event.limit === 'rate')
              setRateLimit({ until: null });
          } else if (event.type === 'meta' && event.mode === 'ai') setAvailability('ready');
          if (event.type === 'meta') setAttention(event.attention === true);
          if (event.type === 'done') {
            completed = true;
            // The answer is complete: a slow save is not a stall. Keep reading for the conversation id, but
            // give up quietly (no "stalled") if the stream never closes.
            window.clearTimeout(stallTimer);
            stallTimer = window.setTimeout(() => controller.abort(), STALL_MS);
            return;
          }
          if (event.type === 'context') {
            if (seq === requestSeq.current)
              setTurns(current =>
                current.map((turn, index) =>
                  index === current.length - 1 && event.assistantProof
                    ? { ...turn, contextProof: event.assistantProof }
                    : index === current.length - 2 && event.userProof
                      ? { ...turn, contextProof: event.userProof }
                      : turn
                )
              );
            return;
          }
          if (event.type === 'error') reportedError = true;
          if (event.type === 'delta' && event.text) deltas.push(event.text);
          else if (event.type === 'meta' && event.mode)
            patch(turn => ({
              ...turn,
              mode: event.mode,
              ...(typeof event.intent === 'string' ? { intent: event.intent } : {}),
            }));
          else if (event.type === 'tool' && event.label)
            patch(turn => ({ ...turn, activity: event.label }));
          else if (event.type === 'chart')
            patch(turn => ({ ...turn, charts: mergeChart(turn.charts, event.chart) }));
          else if (event.type === 'investigation')
            patch(turn => ({
              ...turn,
              investigation: mergeInvestigationStep(turn.investigation, event.step),
            }));
          else if (event.type === 'proposal' && event.proposal)
            patch(turn => ({
              ...turn,
              activity: undefined,
              proposals: [...(turn.proposals ?? []), event.proposal!],
            }));
          else if (event.type === 'citations' && Array.isArray(event.items))
            patch(turn => ({ ...turn, citations: event.items as Citation[] }));
          else if (event.type === 'trace')
            patch(turn => ({ ...turn, trace: parseTrace(event.trace) }));
          else if (event.type === 'suggestions' && Array.isArray(event.items))
            patch(turn => ({
              ...turn,
              suggestions: (event.items as unknown[]).filter(
                (item): item is string => typeof item === 'string'
              ),
            }));
          else if (event.type === 'notice' && event.text)
            patch(turn => ({ ...turn, notice: event.text }));
          else if (event.type === 'conversation' && event.id) {
            if (seq === requestSeq.current) setConversationId(event.id);
          } else if (event.type === 'error')
            // Keep what already arrived and say it was cut off, rather than hiding the failure.
            patch(turn =>
              turn.content
                ? {
                    ...turn,
                    activity: undefined,
                    failed: true,
                    error: event.message || 'The response was interrupted.',
                  }
                : {
                    ...turn,
                    activity: undefined,
                    failed: true,
                    content: event.message || 'Something went wrong.',
                  }
            );
        };
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (!completed) armStall();
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline >= 0) {
              processLine(buffer.slice(0, newline));
              buffer = buffer.slice(newline + 1);
              newline = buffer.indexOf('\n');
            }
          }
          buffer += decoder.decode();
          processLine(buffer);
          if (!completed && !reportedError) {
            patch(turn =>
              turn.content
                ? {
                    ...turn,
                    failed: true,
                    error: 'The response was interrupted. Please ask again to continue.',
                  }
                : {
                    ...turn,
                    failed: true,
                    content: 'The response was interrupted. Please try again.',
                  }
            );
          }
        } finally {
          reader.releaseLock?.();
        }
      } catch (error) {
        if (stalled)
          patch(turn => ({
            ...turn,
            failed: true,
            content: turn.content || 'The answer stalled. Please try again.',
            ...(turn.content ? { error: 'The answer stalled. Ask again to continue.' } : {}),
          }));
        else if ((error as { name?: string }).name !== 'AbortError') {
          patch(turn => ({
            ...turn,
            failed: true,
            content: turn.content || 'I could not reach the server. Please try again.',
            ...(turn.content
              ? { error: 'The response was interrupted. Please ask again to continue.' }
              : {}),
          }));
        }
      } finally {
        window.clearTimeout(stallTimer);
        patch(turn => ({ ...turn, activity: undefined }));
        if (seq === requestSeq.current) {
          liveRequestRef.current = null;
          setBusy(false);
          if (!openRef.current) setAnswerReady(seq);
        }
      }
    },
    [busy, conversationId, incidentId, pageContext, contextKey, aiEnabled, turns, online, mentions]
  );

  const retryAnswer = useCallback((index: number) => {
    const questionIndex = turnsRef.current
      .slice(0, index)
      .findLastIndex(turn => turn.role === 'user');
    if (questionIndex >= 0)
      void sendRef.current(turnsRef.current.at(questionIndex)!.content, questionIndex, true);
  }, []);
  const editQuestion = useCallback((index: number) => {
    const turn = turnsRef.current.at(index);
    if (!turn || turn.role !== 'user') return;
    setEditIndex(index);
    setInput(turn.content);
    inputRef.current?.focus();
  }, []);
  const jumpToLatest = () => {
    atBottomRef.current = true;
    setUnread(false);
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'instant' });
  };

  /** Ends the answer in progress on screen, keeping what arrived, with `notice` under it. */
  const haltLive = useCallback((notice: string) => {
    // Keep the text that already arrived this frame, then fence late chunks before aborting so they
    // cannot replace the retained answer.
    deltasRef.current?.flush();
    deltasRef.current = null;
    requestSeq.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    liveRequestRef.current = null;
    setTurns(current =>
      current.map((turn, index) =>
        index === current.length - 1 && turn.role === 'assistant'
          ? {
              ...turn,
              activity: undefined,
              notice: [turn.notice, notice].filter(Boolean).join(' '),
            }
          : turn
      )
    );
    setBusy(false);
  }, []);
  const stopResponse = () => {
    // A question queued behind the stopped answer (asked from elsewhere on the page) is dropped too.
    pendingRef.current = null;
    haltLive('Response stopped. You can ask a follow-up.');
    inputRef.current?.focus();
  };

  /**
   * Moves the answer in progress to the server, which finishes it, saves it to this conversation and sends a
   * notification. `leaving`: the tab is closing or hidden, so the request must outlive the page.
   */
  const { handOff, cancel: cancelBackground } = background;
  // The turn handed off from this chat, and the question count then: a new question since means "moved on".
  const handedOff = useRef<{ id: string; seq: number } | null>(null);
  const keepWorking = useCallback(
    async (leaving = false) => {
      const payload = liveRequestRef.current;
      if (!payload || handingOffRef.current) return;
      handingOffRef.current = true;
      try {
        const outcome = await handOff(payload, leaving);
        // The answer finished (or another started) meanwhile: it is already here, so the copy is not needed.
        if (liveRequestRef.current !== payload) {
          if (outcome.ok && outcome.id) void cancelBackground(outcome.id);
          return;
        }
        if (outcome.ok) {
          haltLive(
            `${name} is finishing this in the background. You will get a notification when the answer is ready.`
          );
          // After haltLive, which fences the live answer by moving the question count on.
          handedOff.current = { id: outcome.id, seq: requestSeq.current };
        } else if (!leaving) setHandOffError(outcome.message);
      } finally {
        handingOffRef.current = false;
      }
    },
    [handOff, cancelBackground, haltLive, name]
  );

  // Leaving mid-investigation (closing the tab, or leaving it hidden) hands it over instead of losing it. A
  // quick tab switch is not leaving, and the answer on screen keeps running until the server accepts it.
  useEffect(() => {
    if (!history) return;
    let hiddenTimer: number | undefined;
    const leave = () => {
      if (turnsRef.current.at(-1)?.investigation?.length) void keepWorking(true);
    };
    const visibility = () => {
      window.clearTimeout(hiddenTimer);
      if (document.visibilityState === 'hidden')
        hiddenTimer = window.setTimeout(leave, HIDDEN_HANDOFF_MS);
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', leave);
    return () => {
      window.clearTimeout(hiddenTimer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', leave);
    };
  }, [history, keepWorking]);

  // A question asked while busy goes out as soon as the current answer is complete.
  useEffect(() => {
    if (busy || !pendingRef.current) return;
    const next = pendingRef.current;
    pendingRef.current = null;
    void send(next);
  }, [busy, send]);

  const stopCurrent = useCallback(() => {
    deltasRef.current?.cancel();
    deltasRef.current = null;
    requestSeq.current += 1;
    abortRef.current?.abort();
    pendingRef.current = null;
    setBusy(false);
  }, []);

  const newChat = useCallback(() => {
    stopCurrent();
    setTurns([]);
    setInput('');
    setMentions([]);
    setEditIndex(null);
    setActionOutcome(null);
    setAttention(false);
    setGreeting(true);
    atBottomRef.current = true;
    setUnread(false);
    setConversationId(undefined);
    setShowHistory(false);
    clearEvidence();
    inputRef.current?.focus();
  }, [stopCurrent, clearEvidence]);

  const loadSaved = useCallback(async (cursor?: string) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch(
        cursor ? `${CONVERSATIONS_URL}?cursor=${encodeURIComponent(cursor)}` : CONVERSATIONS_URL,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as {
        data?: { conversations?: SavedConversation[]; nextCursor?: string | null };
      };
      const page = body.data?.conversations ?? [];
      setSaved(current =>
        cursor
          ? [...new Map([...(current ?? []), ...page].map(item => [item.id, item])).values()]
          : page
      );
      setHistoryCursor(body.data?.nextCursor ?? null);
    } catch {
      setHistoryError('Saved conversations could not be loaded.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const toggleHistory = useCallback(() => {
    if (!showHistory) void loadSaved();
    setShowHistory(!showHistory);
  }, [loadSaved, showHistory]);

  const openSaved = useCallback(
    async (id: string, quiet = false) => {
      setHistoryError('');
      const load = ++openSeq.current;
      const sendAt = requestSeq.current;
      // A newer load, a question sent or a new chat since this started: what is on screen wins.
      const stale = () =>
        load !== openSeq.current ||
        requestSeq.current !== sendAt ||
        // The reload restore never replaces a chat already under way.
        (quiet && turnsRef.current.length > 0);
      try {
        const response = await fetch(`${CONVERSATIONS_URL}/${encodeURIComponent(id)}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as {
          data?: {
            conversation?: {
              id: string;
              incidentId: string | null;
              messages: Array<{
                role: 'user' | 'assistant';
                content: string;
                contextProof?: string;
                notice?: string;
                envelope?: StoredTurnEnvelope;
              }>;
            };
          };
        };
        const conversation = body.data?.conversation;
        if (stale()) return;
        if (!conversation) throw new Error('missing');
        stopCurrent();
        setInput('');
        setMentions([]);
        setEditIndex(null);
        setActionOutcome(null);
        setAttention(false);
        atBottomRef.current = true;
        setUnread(false);
        setTurns(
          conversation.messages.map(({ role, content, contextProof, notice, envelope }, index) => ({
            id: `${conversation.id}-${index}`,
            role,
            content,
            incidentId:
              envelope?.context?.kind === 'incident'
                ? envelope.context.id
                : envelope?.context
                  ? undefined
                  : (conversation.incidentId ?? undefined),
            context: envelope?.context
              ? envelope.context.kind === 'general'
                ? 'general'
                : `${envelope.context.kind}:${envelope.context.id}`
              : conversation.incidentId
                ? `incident:${conversation.incidentId}`
                : 'general',
            contextProof,
            ...(envelope?.mode === 'ai' || envelope?.mode === 'basic'
              ? { mode: envelope.mode }
              : {}),
            citations: envelope?.citations,
            charts: envelope?.charts,
            trace: parseTrace(envelope?.trace),
            savedActions: envelope?.actions,
            notice:
              [...new Set([...(envelope?.notices ?? []), ...(notice ? [notice] : [])])].join(' ') ||
              undefined,
          }))
        );
        setConversationId(conversation.id);
        setShowHistory(false);
      } catch {
        if (stale()) return;
        if (quiet) storeConversation(undefined);
        else setHistoryError('That conversation could not be opened.');
      }
    },
    [stopCurrent]
  );

  // Restore this tab's conversation after a reload; keep the stored id in step with what is open. A link to
  // a conversation (a finished background answer's notification) wins over the stored one; its
  // `squire=open` opens the panel (use-squire-surfaces).
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (linkedConversation) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete(CONVERSATION_PARAM);
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`
        );
      } catch {
        // The link still works; only the address bar keeps its parameter.
      }
    }
    const id = linkedConversation ?? readStoredConversation();
    // After the effect, like a subscription callback: opening sets state.
    if (id && history) void Promise.resolve().then(() => openSaved(id, true));
  }, [history, openSaved, linkedConversation]);
  // Written only when the id changes, never with the initial undefined: on mount that would wipe the stored
  // id before the restore above has read the conversation back.
  const storedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (conversationId === storedId.current) return;
    storedId.current = conversationId;
    storeConversation(conversationId);
  }, [conversationId]);

  const { markOpened, ready: readyBackground } = background;
  const openBackground = useCallback(
    (turn: BackgroundTurn) => {
      if (!turn.conversationId) return;
      markOpened(turn.id);
      void openSaved(turn.conversationId);
    },
    [markOpened, openSaved]
  );
  // A handed-off answer ended: replace the placeholder when the person is still looking at it, else cue them.
  const { finished, clearFinished } = background;
  const [cue, setCue] = useState<{ text: string; conversationId: string | null } | null>(null);
  useEffect(() => {
    if (!finished) return;
    clearFinished();
    const here =
      openRef.current && handedOff.current?.id === finished.id
        ? handedOff.current.seq === requestSeq.current
        : false;
    if (finished.status === 'DONE' && finished.conversationId) {
      if (here) {
        markOpened(finished.id);
        void openSaved(finished.conversationId);
      } else if (!openRef.current)
        setCue({ text: `${name} has an answer ready`, conversationId: finished.conversationId });
    } else if (finished.status !== 'DONE' && !here)
      setCue({ text: `${name} could not finish that answer.`, conversationId: null });
    else if (finished.status !== 'DONE') setHandOffError(`${name} could not finish that answer.`);
  }, [finished, clearFinished, markOpened, openSaved, name]);
  // Opening the panel (by any route) clears the cue.
  useEffect(() => {
    if (open) setCue(null);
  }, [open]);
  const readyIds = useMemo(() => new Set(readyBackground.map(turn => turn.id)), [readyBackground]);

  const removeSaved = useCallback(
    async (id?: string) => {
      setHistoryError('');
      try {
        const response = await fetch(
          id ? `${CONVERSATIONS_URL}/${encodeURIComponent(id)}` : CONVERSATIONS_URL,
          { method: 'DELETE' }
        );
        if (!response.ok && response.status !== 404) throw new Error(String(response.status));
        if (!id || id === conversationId) {
          stopCurrent();
          setConversationId(undefined);
          setTurns([]);
          setInput('');
        }
        setConfirmDeleteAll(false);
        setConfirmDelete(null);
        await loadSaved();
      } catch {
        setHistoryError('Could not delete. Please try again.');
      }
    },
    [conversationId, loadSaved, stopCurrent]
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const cheerUp = useCallback(() => {
    if (tone !== 'calm') return false;
    setCheer(true);
    return true;
  }, [tone]);
  const runCommand = (command: SlashCommand) => {
    if (command.prompt) void send(command.prompt);
    else newChat();
  };
  const notes = useMemo(
    () => buildNotes({ name, tone, shifts, now: clock, answerReady }),
    [name, tone, shifts, clock, answerReady]
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input, editIndex ?? undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      // While an answer arrives the text stays in the box (Stop first); nothing is queued out of sight.
      if (!busy) void send(input, editIndex ?? undefined);
    }
  };

  const availabilityState = squireAvailabilityState({ availability, rateLimit });
  const canRetry = !busy && turns.some(turn => turn.role === 'user');
  const retryLatest = () => retryAnswer(turnsRef.current.length);

  // What the conversation is about: the incident it is scoped to (short id and title), else the page.
  const pageContextLabel = describeSquireContext(pathname);
  const pageSubject = pageContextLabel.subject;
  const incidentTitle = typeof currentIncident?.title === 'string' ? currentIncident.title : '';
  const contextChip = scopeId
    ? {
        label: [incidentRef(scopeId), incidentTitle].filter(Boolean).join(' · '),
        title: `Discussing ${incidentTitle || incidentRef(scopeId)}`,
        urgent: incidentAttention,
      }
    : {
        label: pageSubject === 'general' ? 'General' : `This ${pageSubject.replace('_', ' ')}`,
        title: pageContextLabel.label,
        urgent: false,
      };
  const showContext = !showHistory;
  const pageSuggestions =
    !scopeId && pageContext ? (PAGE_SUGGESTIONS[pageContext.kind] ?? null) : null;
  const composerChips =
    (scopeId && !showHistory) || (showContext && surfaces.evidence) ? (
      <>
        {scopeId && !showHistory && (
          <span
            title="This conversation includes the incident"
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${toneClasses('neutral').soft}`}
          >
            {incidentAttention && (
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${toneClasses('critical').solid}`}
              />
            )}
            {incidentRef(scopeId)}
          </span>
        )}
        {showContext && (
          <SquireEvidenceChip
            evidence={surfaces.evidence}
            incidentId={incidentId}
            mobile={fullscreen}
            onDismiss={clearEvidence}
          />
        )}
      </>
    ) : null;

  return (
    <div
      className={
        fullscreen
          ? `fixed print:hidden ${open ? 'inset-0 z-70' : 'bottom-24 right-4 z-50'}`
          : dock.docked && open
            ? DOCK_WRAPPER_CLASS
            : // Floating, the panel clears the desktop status bar like everything else pinned to the bottom.
              `fixed z-40 print:hidden ${open ? 'inset-0 sm:inset-auto sm:bottom-[calc(var(--status-bar-height,0px)+1rem)]' : 'bottom-4'} ${side === 'left' ? 'left-0 sm:left-4' : 'right-0 sm:right-4'}`
      }
      data-side={side}
      data-presentation={fullscreen ? 'fullscreen' : dock.docked && open ? 'docked' : 'panel'}
    >
      {launcher === 'FLOATING' && !fullscreen && (
        <SquireBarCompanion
          name={name}
          open={open}
          onOpen={() => setOpen(true)}
          onAsk={question => {
            setOpen(true);
            void send(question);
          }}
          launcherState={busy || !online ? mascotState : 'idle'}
          animated={animated}
          notes={notes}
          unread={answerReady !== null}
          statusLabel={statusLabel}
        />
      )}
      {!open && launcher === 'FLOATING' && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls={panelId}
          // An open right-side sheet (Insights inspector) owns that corner; the launcher steps aside until it closes.
          className={`flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-lg transition hover:bg-accent focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 lg:[html[data-squire-bar=on]_&]:hidden ${side === 'left' ? '' : '[body:has([data-sheet-side=right][data-state=open])_&]:hidden'}`}
        >
          <SquireAvatar
            animated={animated}
            state={busy || !online ? mascotState : incidentAttention ? 'alert' : 'idle'}
          />
          <span>Ask {name}</span>
          {readyBackground.length > 0 ? (
            <>
              <span
                data-testid="squire-ready-badge"
                className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold text-primary-foreground"
                aria-hidden="true"
              >
                {readyBackground.length}
              </span>
              <span className="sr-only">
                , {readyBackground.length} answer{readyBackground.length === 1 ? '' : 's'} ready
              </span>
            </>
          ) : (
            answerReady !== null && (
              <>
                <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                <span className="sr-only">, an answer is ready</span>
              </>
            )
          )}
        </button>
      )}
      <div
        role="status"
        aria-live="polite"
        className={cue ? 'fixed bottom-20 right-4 z-50' : 'sr-only'}
      >
        {cue && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-lg">
            <span>{cue.text}</span>
            {cue.conversationId && (
              <button
                type="button"
                className="font-medium underline underline-offset-2"
                onClick={() => {
                  const id = cue.conversationId!;
                  const turn = background.turns.find(item => item.conversationId === id);
                  if (turn) markOpened(turn.id);
                  setOpen(true);
                  void openSaved(id);
                }}
              >
                Open
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              className="text-muted-foreground"
              onClick={() => setCue(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>
      {open && (
        <section
          ref={dialogRef}
          id={panelId}
          role="dialog"
          // Docked, the panel sits beside a page that stays usable, so it is not modal and Tab may leave it.
          aria-modal={dock.docked ? undefined : 'true'}
          aria-label={`${name}, your incident assistant`}
          tabIndex={-1}
          onKeyDown={event => {
            // A menu inside the panel handles (and prevents) its own Escape and Tab.
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') close();
            else if (dialogRef.current && !dock.docked) trapTabKey(event, dialogRef.current);
          }}
          // z-50 keeps the panel (and its send button) above the status-bar companion in the same layer.
          className={
            fullscreen
              ? 'relative z-50 flex h-dvh w-screen min-w-0 flex-col overflow-hidden bg-card pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]'
              : dock.docked
                ? `${DOCK_PANEL_CLASS} z-50`
                : `relative z-50 flex h-dvh w-screen min-w-0 flex-col overflow-hidden bg-card sm:h-[min(42.5rem,calc(100dvh-var(--status-bar-height,0px)-2rem))] sm:rounded-2xl sm:border sm:border-border sm:shadow-xl ${expanded ? 'sm:w-[min(45rem,calc(100vw-2rem))]' : 'sm:w-[min(26.25rem,calc(100vw-2rem))]'} motion-safe:transition-[width] motion-safe:duration-200`
          }
        >
          <SquireHeader
            name={name}
            animated={animated}
            mascotState={mascotState}
            statusLabel={statusLabel}
            context={contextChip}
            fullscreen={fullscreen}
            dock={dock}
            side={side}
            expanded={expanded}
            onToggleExpanded={fullscreen || dock.docked ? null : () => setExpanded(value => !value)}
            onSwitchSide={fullscreen || dock.docked ? null : switchSide}
            hasHistory={Boolean(history)}
            showHistory={showHistory}
            onToggleHistory={toggleHistory}
            onNewChat={newChat}
            onClose={close}
          />

          {!showHistory && availabilityState && (
            <SquireAvailabilityNotice
              state={availabilityState}
              rateLimit={rateLimit}
              reason={policyReason}
              canManageAi={canManageAi}
              canRetry={canRetry}
              onRetry={retryLatest}
            />
          )}
          {history && (
            <SquireBackgroundAnswers
              turns={background.turns}
              readyIds={readyIds}
              timeZone={userTimeZone}
              onOpen={openBackground}
              onCancel={id => void background.cancel(id)}
            />
          )}
          {actionOutcome && (
            <p
              role="status"
              className={`shrink-0 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium ${toneClasses(actionOutcome === 'success' ? 'ok' : 'critical').text}`}
            >
              {actionOutcome === 'success'
                ? 'Your confirmed action completed.'
                : 'The action could not be completed. Review the result below.'}
            </p>
          )}
          {pinBriefing && showContext && incidentId && (
            <SquirePinnedBriefing incidentId={incidentId} mobile={fullscreen} />
          )}
          {showHistory && history ? (
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
              <label className="flex items-center gap-2 rounded-xl border border-border px-3">
                <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  aria-label="Search loaded conversations"
                  placeholder="Search loaded chats…"
                  className="min-h-11 min-w-0 flex-1 bg-transparent outline-hidden"
                  value={historySearch}
                  onChange={event => setHistorySearch(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                Only you can see these. They are deleted after {history.retentionDays}{' '}
                {history.retentionDays === 1 ? 'day' : 'days'} after the last message. Reading them
                does not reset this period.
              </p>
              {historyError && (
                <p role="alert" className="text-xs text-destructive">
                  {historyError}
                </p>
              )}
              {historyError && (
                <button
                  type="button"
                  disabled={historyLoading}
                  onClick={() => void loadSaved()}
                  className="min-h-11 underline"
                >
                  Retry history
                </button>
              )}
              {saved === null && !historyError && <p className="text-muted-foreground">Loading…</p>}
              {saved?.length === 0 && (
                <p className="text-muted-foreground">
                  {historyCursor
                    ? 'No readable chats on this page. Load older chats to continue.'
                    : 'No saved conversations yet.'}
                </p>
              )}
              {saved && saved.length > 0 && (
                <>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {saved
                      .filter(item =>
                        item.title.toLowerCase().includes(historySearch.toLowerCase().trim())
                      )
                      .map(item => (
                        <li key={item.id} className="flex items-center gap-2 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => void openSaved(item.id)}
                            className="min-h-11 min-w-0 flex-1 rounded px-1 py-1 text-left hover:bg-accent"
                          >
                            <span className="block truncate">{item.title}</span>
                            <span className="block text-xs text-muted-foreground">
                              {formatDateTime(item.updatedAt, userTimeZone, {
                                includeTimeZone: true,
                              })}{' '}
                              · {item.messageCount} messages
                            </span>
                          </button>
                          {confirmDelete === item.id ? (
                            <div
                              role="group"
                              aria-label={`Confirm deleting ${item.title}`}
                              className="flex shrink-0 items-center gap-1 text-xs"
                            >
                              <button
                                type="button"
                                // Focus lands here when the confirmation opens, so Enter does not delete.
                                autoFocus
                                onClick={() => setConfirmDelete(null)}
                                className="min-h-11 rounded px-2 hover:bg-accent sm:min-h-8"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeSaved(item.id)}
                                className="min-h-11 rounded px-2 font-medium text-destructive hover:bg-accent sm:min-h-8"
                              >
                                Delete
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(item.id)}
                              aria-label={`Delete conversation: ${item.title}`}
                              className="flex min-h-11 min-w-11 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                  {confirmDeleteAll ? (
                    <div
                      role="group"
                      aria-label="Confirm deleting all saved conversations"
                      className="flex items-center gap-3 text-xs"
                    >
                      <span>Delete all of them?</span>
                      <button
                        type="button"
                        onClick={() => void removeSaved()}
                        className="min-h-11 font-medium text-destructive hover:underline sm:min-h-8"
                      >
                        Delete all
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAll(false)}
                        className="min-h-11 hover:underline sm:min-h-8"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAll(true)}
                      className="min-h-11 text-xs text-destructive underline-offset-2 hover:underline sm:min-h-8"
                    >
                      Delete all saved conversations
                    </button>
                  )}
                </>
              )}
              {saved &&
                saved.length > 0 &&
                historySearch.trim() &&
                !saved.some(item =>
                  item.title.toLowerCase().includes(historySearch.toLowerCase().trim())
                ) && (
                  <p className="text-sm text-muted-foreground">
                    No matching chats on the loaded pages.
                  </p>
                )}
              {historyCursor && (
                <button
                  type="button"
                  disabled={historyLoading}
                  onClick={() => void loadSaved(historyCursor)}
                  className="min-h-11 w-full rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                >
                  {historyLoading ? 'Loading older chats…' : 'Load older chats'}
                </button>
              )}
            </div>
          ) : (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                ref={scrollRef}
                role="log"
                aria-label="Conversation"
                aria-live="off"
                aria-busy={busy}
                onScroll={event => {
                  const el = event.currentTarget;
                  atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
                  if (atBottomRef.current) setUnread(false);
                }}
                className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4 text-sm"
              >
                {turns.length === 0 && (
                  <SquireEmptyState
                    mascotState={mascotState}
                    animated={animated}
                    headline={emptyHeadline(
                      tone,
                      new Date().getHours(),
                      userName?.trim().split(/\s+/)[0]
                    )}
                    tip={tone === 'calm' ? emptyTip(seed, shortcutLabel()) : null}
                    pageSuggestions={pageSuggestions}
                    description={
                      scopeId
                        ? 'I can read this incident, its alerts, recent changes, on-call and runbooks.'
                        : 'I can check incidents, service ownership, on-call coverage and runbooks.'
                    }
                    incidentSuggestions={scopeId ? INCIDENT_SUGGESTIONS : []}
                    workspaceSuggestions={
                      scopeId || pageSuggestions ? SUGGESTIONS.slice(0, 2) : SUGGESTIONS
                    }
                    onAsk={suggestion => void send(suggestion)}
                  />
                )}
                {turns.map((turn, index) => (
                  <Fragment key={turn.id ?? index}>
                    {turn.role === 'user' &&
                      turn.context &&
                      previousContext(turns, index) !== undefined &&
                      previousContext(turns, index) !== turn.context && (
                        <p
                          role="separator"
                          className="flex items-center gap-2 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border"
                        >
                          {contextDividerLabel(turn.context)}
                        </p>
                      )}
                    <SquireMessage
                      turn={turn}
                      index={index}
                      name={name}
                      busy={busy && index === turns.length - 1}
                      last={index === turns.length - 1}
                      animated={animated}
                      onOutcome={setActionOutcome}
                      onRetry={retryAnswer}
                      onEdit={editQuestion}
                      question={index > 0 ? turns[index - 1]?.content : undefined}
                      conversationId={conversationId}
                      pendingLabel={pendingLine(tone, seed + index)}
                      onCheer={cheerUp}
                    />
                  </Fragment>
                ))}
                {!busy && (turns.at(-1)?.suggestions?.length ?? 0) > 0 && (
                  <div aria-label="Suggested questions" className="flex flex-wrap gap-2 pl-9">
                    {turns.at(-1)!.suggestions!.map(suggestion => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void send(suggestion)}
                        className="min-h-11 rounded-full border border-border bg-card px-3 py-1 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
                <div ref={endRef} />
              </div>
              {unread && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="pointer-events-auto min-h-11 rounded-full bg-card shadow-md sm:min-h-8"
                    onClick={jumpToLatest}
                  >
                    <ArrowDown aria-hidden="true" />
                    Jump to latest
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="sr-only" role="status" aria-live="polite" data-testid="squire-progress">
            {progressAnnouncement(busy, lastTurn, turns.length > 0)}
          </div>
          {busy && history && !showHistory && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/40 px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">
                {lastTurn?.investigation?.length
                  ? 'Investigations can take a while.'
                  : 'No need to wait here.'}
              </span>
              <button
                type="button"
                onClick={() => void keepWorking()}
                className="min-h-11 rounded font-medium underline underline-offset-2 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
              >
                Keep working in the background
              </button>
              {handOffError && (
                <p role="alert" className={`w-full ${toneClasses('critical').text}`}>
                  {handOffError}
                </p>
              )}
            </div>
          )}
          {!online && (
            <p
              role="status"
              className="shrink-0 border-t border-border bg-muted/40 px-3 py-2 text-xs"
            >
              You are offline. Your draft is kept here. Reconnect to send a message.
            </p>
          )}
          <SquireComposer
            name={name}
            inputId={`${panelId}-input`}
            inputRef={inputRef}
            value={input}
            maxLength={MAX_LENGTH}
            placeholder={incidentId ? 'Ask about this incident…' : 'Ask a question…'}
            onChange={setInput}
            onSubmit={onSubmit}
            onKeyDown={onKeyDown}
            busy={busy}
            canSend={online && input.trim().length > 0}
            onStop={stopResponse}
            editing={editIndex !== null}
            onCancelEdit={() => {
              setEditIndex(null);
              setInput('');
            }}
            chips={composerChips}
            retentionDays={history?.retentionDays ?? null}
            fullscreen={fullscreen}
            commands={matchSlashCommands(input, Boolean(scopeId), pageContext?.kind)}
            onCommand={runCommand}
            mentions={mentions}
            onMentionsChange={setMentions}
          />
        </section>
      )}
    </div>
  );
}
