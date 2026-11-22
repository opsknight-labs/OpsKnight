'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import OpsKnightSquire, { type SquireState } from './OpsKnightSquire';
import { isDelivered, markDelivered, type SquireNote } from './squire-messages';
import { shortcutLabel } from './squire-voice';
import './squire-bar.css';

/**
 * Squire on duty: on desktop the assistant sleeps in the status bar's right-hand corner and, only when
 * the person has been idle for a while, does a short round of a squire's duties (keeps watch with a
 * lantern, tends the shield, and once per session brings a message offering help) before going back to
 * sleep. A round never starts while the chat is open, the tab is hidden, someone is typing or working,
 * or reduced motion is requested; at most a few rounds play per session. Hovering wakes him up.
 *
 * He is also the messenger: notes (a one-time introduction, on-call heads-ups, "your answer is ready")
 * arrive on his scroll even with motion off; with motion he steps out to deliver them. He rests awake and
 * only dozes after a few quiet minutes, so a sleeping knight never reads as "switched off".
 */

type Duty = 'watch' | 'polish' | 'scout' | 'message' | 'rest';
type Pose = Duty | 'walk' | 'idle';

/** A round starts only after this long without pointer, key or scroll activity. */
const IDLE_BEFORE_ROUND_MS = 30_000;
/** Minimum gap between rounds, and the most rounds one browser session sees. */
const ROUND_GAP_MS = 6 * 60_000;
const MAX_ROUNDS_PER_SESSION = 3;
const SESSION_KEY = 'opsknight.squire-bar.rounds';
/** He dozes off after this long without activity, and wakes on the next pointer, key or scroll. */
const DOZE_AFTER_MS = 2 * 60_000;
/** How long a note stays up before he rolls the scroll away by himself. */
const NOTE_MS = 15_000;
const INTRO_MS = 20_000;

const readRounds = () => {
  try {
    return Number(window.sessionStorage.getItem(SESSION_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeRounds = (value: number) => {
  try {
    window.sessionStorage.setItem(SESSION_KEY, String(value));
  } catch {
    // Storage can be blocked; rounds are then capped per page load only.
  }
};

export default function SquireBarCompanion({
  name,
  open,
  onOpen,
  launcherState,
  animated,
  notes = [],
  unread = false,
  statusLabel,
}: {
  name: string;
  /** The chat panel is open: stay at the post, awake. */
  open: boolean;
  onOpen: () => void;
  /** State the launcher reports (thinking while answering, alert on a high-urgency incident). */
  launcherState: SquireState;
  /** The administrator's "animate the assistant" setting. */
  animated: boolean;
  /** Notes to deliver, most important first; each is shown once (see squire-messages). */
  notes?: readonly SquireNote[];
  /** An answer finished while the chat was closed. */
  unread?: boolean;
  /** What the assistant is doing, for the hover title. */
  statusLabel?: string;
}) {
  const [bar, setBar] = useState<DOMRect | null>(null);
  const [x, setX] = useState<number | null>(null);
  const [walkMs, setWalkMs] = useState(0);
  const [facing, setFacing] = useState<'left' | 'right'>('right');
  const [pose, setPose] = useState<Pose>('rest');
  const [mood, setMood] = useState<SquireState>('idle');
  const [dozing, setDozing] = useState(false);
  const [note, setNote] = useState<SquireNote | null>(null);
  // Bumped after a delivery (or a failed attempt) so the next waiting note gets its turn.
  const [noteTick, setNoteTick] = useState(0);
  const [scrollOpen, setScrollOpen] = useState(false);
  const [lantern, setLantern] = useState(false);
  const [shield, setShield] = useState(true);
  const [awake, setAwake] = useState(false);
  const lastActivity = useRef(0);
  const lastRound = useRef(0);
  const xRef = useRef<number | null>(null);
  const busy = useRef(false);
  const cancelled = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  // Pending waits of the current round; cancelling the round resolves them all at once.
  const waiters = useRef(new Set<() => void>());
  const wait = useCallback(
    (ms: number) =>
      new Promise<void>(resolve => {
        if (cancelled.current) return resolve();
        const done = () => {
          clearTimeout(timer);
          waiters.current.delete(done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        waiters.current.add(done);
      }),
    []
  );

  // Track the status bar: it exists only on desktop layouts and moves with the sidebar.
  useEffect(() => {
    const element = document.getElementById('status-bar');
    if (!element) return;
    document.documentElement.dataset.squireBar = 'on';
    const measure = () => setBar(element.getBoundingClientRect());
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      delete document.documentElement.dataset.squireBar;
    };
  }, []);

  // Home is the bar's right-hand corner.
  const home = bar ? bar.right - 56 : null;
  /** Snap to the post without walking (used when a round is cut short). */
  const snapHome = useCallback(() => {
    if (home === null) return;
    stageRef.current?.classList.remove('crouch', 'hurry', 'settle');
    xRef.current = home;
    setWalkMs(0);
    setX(home);
  }, [home]);
  useEffect(() => {
    if (home === null || busy.current) return;
    xRef.current = home;
    setWalkMs(0);
    setX(home);
  }, [home]);

  const motionAllowed = useCallback(
    () => animated && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [animated]
  );

  const walkTo = useCallback(
    async (target: number, hurry = false) => {
      const from = xRef.current ?? target;
      const distance = Math.abs(target - from);
      if (distance < 2) return;
      setFacing(target < from ? 'left' : 'right');
      stageRef.current?.classList.add('crouch');
      await wait(150);
      stageRef.current?.classList.remove('crouch');
      const ms = Math.max(700, distance * (hurry ? 5 : 9));
      setWalkMs(ms);
      setPose('walk');
      if (hurry) stageRef.current?.classList.add('hurry');
      xRef.current = target;
      setX(target);
      await wait(ms);
      stageRef.current?.classList.remove('hurry');
      stageRef.current?.classList.add('settle');
      await wait(480);
      stageRef.current?.classList.remove('settle');
    },
    [wait]
  );

  const round = useCallback(async () => {
    if (busy.current || !bar || home === null) return;
    const typing = document.activeElement?.matches(
      'input, textarea, select, [contenteditable="true"]'
    );
    if (open || document.hidden || typing || !motionAllowed()) return;
    const rounds = readRounds();
    if (rounds >= MAX_ROUNDS_PER_SESSION) return;
    busy.current = true;
    cancelled.current = false;
    lastRound.current = Date.now();
    writeRounds(rounds + 1);
    const stop = () => cancelled.current;
    // He keeps to the right-hand part of the bar, away from the on-call and work items on the left.
    const at = (fraction: number) => bar.left + bar.width * fraction;
    try {
      // Keep watch: a short walk with the lantern.
      setShield(false);
      setLantern(true);
      setMood('listening');
      await walkTo(at(0.72));
      if (stop()) return;
      await wait(700);
      setLantern(false);
      // Tend the shield until it gleams.
      setFacing('right');
      setShield(true);
      setPose('polish');
      setMood('idle');
      await wait(2200);
      if (stop()) return;
      setMood('success');
      setPose('idle');
      await wait(900);
      if (stop()) return;
      // The first round of a session also brings a message offering help.
      if (rounds === 0) {
        setNote(null);
        setPose('message');
        setMood('greeting');
        setScrollOpen(true);
        await wait(5000);
        setScrollOpen(false);
      }
    } finally {
      setLantern(false);
      setScrollOpen(false);
      setMood('idle');
      // Cut short (the chat opened): straight back to the post, no walk while the chat is open.
      if (cancelled.current) snapHome();
      else if (home !== null) await walkTo(home);
      setFacing('right');
      setShield(true);
      setPose('rest');
      setMood('idle');
      busy.current = false;
    }
  }, [bar, home, open, motionAllowed, walkTo, wait, snapHome]);

  /** Carry one note: step out (with motion), unroll the scroll, wait for a reply or the timeout, return. */
  const deliver = useCallback(
    async (next: SquireNote) => {
      if (busy.current || home === null || open) return false;
      busy.current = true;
      cancelled.current = false;
      markDelivered(next);
      setDozing(false);
      try {
        setMood('greeting');
        if (motionAllowed()) {
          await walkTo(home - 64, true);
          if (cancelled.current) return true;
          setFacing('right');
        }
        setNote(next);
        setPose('message');
        setScrollOpen(true);
        await wait(next.id === 'intro' ? INTRO_MS : NOTE_MS);
      } finally {
        setScrollOpen(false);
        setMood('idle');
        if (cancelled.current) snapHome();
        else if (motionAllowed()) await walkTo(home);
        setFacing('right');
        setPose('rest');
        busy.current = false;
        setNoteTick(tick => tick + 1);
      }
      return true;
    },
    [home, open, motionAllowed, walkTo, wait, snapHome]
  );

  /** Roll the scroll away now: ends the current wait, so he walks back as after a timeout. */
  const dismiss = useCallback(() => {
    for (const done of [...waiters.current]) done();
  }, []);

  // The first note still waiting is delivered after a short pause; hidden tabs and running rounds retry.
  useEffect(() => {
    if (!bar || home === null || open) return;
    const next = notes.find(item => !isDelivered(item));
    if (!next) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(
      () => {
        void (async () => {
          if (!document.hidden && (await deliver(next))) return;
          retry = setTimeout(() => setNoteTick(tick => tick + 1), 5_000);
        })();
      },
      next.id === 'intro' ? 2_500 : 1_500
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(retry);
    };
  }, [bar, home, open, notes, deliver, noteTick]);

  // Rounds start only when the person is idle, and never more often than ROUND_GAP_MS.
  useEffect(() => {
    if (!bar) return;
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
      setDozing(false);
    };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll'] as const;
    for (const event of events)
      window.addEventListener(event, touch, { passive: true, capture: true });
    const check = setInterval(() => {
      const now = Date.now();
      if (!busy.current && now - lastActivity.current >= DOZE_AFTER_MS) setDozing(true);
      if (now - lastActivity.current < IDLE_BEFORE_ROUND_MS) return;
      if (lastRound.current && now - lastRound.current < ROUND_GAP_MS) return;
      void round();
    }, 5_000);
    return () => {
      clearInterval(check);
      for (const event of events) window.removeEventListener(event, touch, { capture: true });
    };
  }, [bar, round]);

  // Opening the chat cuts the round short at once: props away, scroll closed, back at his post.
  useEffect(() => {
    if (!open || !busy.current) return;
    cancelled.current = true;
    for (const done of [...waiters.current]) done();
    setScrollOpen(false);
    setLantern(false);
    snapHome();
  }, [open, snapHome]);

  if (!bar || x === null) return null;

  // The launcher's own state wins: answering, offline, or an incident that needs attention.
  const resting = pose === 'rest' && !open && launcherState === 'idle';
  const shownState: SquireState =
    open || launcherState !== 'idle'
      ? launcherState === 'idle'
        ? 'listening'
        : launcherState
      : resting
        ? dozing && !awake
          ? 'offline'
          : 'idle'
        : mood;
  const shownPose: Pose = open || launcherState !== 'idle' ? 'idle' : pose;

  return (
    <>
      <div
        className={`sqbar-glow${lantern ? ' on' : ''}`}
        style={{ transform: `translateX(${x - 66}px)`, transitionDuration: `${walkMs}ms` }}
        aria-hidden="true"
      />
      <div
        ref={stageRef}
        className={`sqbar-stage pose-${shownPose} face-${facing}${lantern ? ' lit' : ''}${resting && awake ? ' awake' : ''}${resting && dozing && !awake ? ' dozing' : ''}`}
        style={{ transform: `translateX(${x}px)`, transitionDuration: `${walkMs}ms` }}
      >
        <button
          type="button"
          className="sqbar-actor"
          onClick={onOpen}
          onPointerEnter={() => setAwake(true)}
          onPointerLeave={() => setAwake(false)}
          onFocus={() => setAwake(true)}
          onBlur={() => setAwake(false)}
          aria-label={unread ? `Ask ${name}, an answer is ready` : `Ask ${name}`}
          title={`${statusLabel ? `${name}: ${statusLabel}` : `Ask ${name}`} · ${shortcutLabel()}`}
        >
          {unread && <span className="sqbar-dot" aria-hidden="true" />}
          <span className="sqbar-contact" aria-hidden="true" />
          <OpsKnightSquire
            state={shownState}
            variant="full"
            size={44}
            animated={animated}
            label=""
            aria-hidden="true"
          />
          <svg
            className={`sqbar-prop sqbar-lantern${lantern ? ' on' : ''}`}
            viewBox="0 0 16 24"
            aria-hidden="true"
          >
            <defs>
              <radialGradient id="sqbar-lg" cx="50%" cy="60%" r="60%">
                <stop offset="0" stopColor="#fff7d6" />
                <stop offset=".5" stopColor="#ffc25a" />
                <stop offset="1" stopColor="#d97706" stopOpacity=".8" />
              </radialGradient>
              <linearGradient id="sqbar-lm" x1="0" x2="1">
                <stop offset="0" stopColor="#52525b" />
                <stop offset=".5" stopColor="#d4d4d8" />
                <stop offset="1" stopColor="#3f3f46" />
              </linearGradient>
            </defs>
            <path d="M5 4 Q8 0 11 4" fill="none" stroke="#71717a" strokeWidth="1.3" />
            <rect x="3" y="4" width="10" height="3" rx="1" fill="url(#sqbar-lm)" />
            <rect
              x="3.5"
              y="7"
              width="9"
              height="12"
              rx="2"
              fill="url(#sqbar-lg)"
              stroke="#a16207"
              strokeWidth=".6"
            />
            <path
              className="sqbar-flame"
              d="M8 9 C10 12 10 15 8 17 C6 15 6 12 8 9Z"
              fill="#fff4c2"
            />
            <rect x="3" y="19" width="10" height="3" rx="1" fill="url(#sqbar-lm)" />
          </svg>
          <svg
            className={`sqbar-prop sqbar-shield${shield ? ' on' : ''}`}
            viewBox="0 0 24 28"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="sqbar-sm" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#fb7185" />
                <stop offset=".45" stopColor="#e11d48" />
                <stop offset="1" stopColor="#881337" />
              </linearGradient>
              <linearGradient id="sqbar-rim" x1="0" x2="1">
                <stop offset="0" stopColor="#a1a1aa" />
                <stop offset=".5" stopColor="#f4f4f5" />
                <stop offset="1" stopColor="#71717a" />
              </linearGradient>
              <clipPath id="sqbar-sc">
                <path d="M12 1 L22 4 V13 C22 20 17 24.5 12 27 C7 24.5 2 20 2 13 V4 Z" />
              </clipPath>
            </defs>
            <path
              d="M12 1 L22 4 V13 C22 20 17 24.5 12 27 C7 24.5 2 20 2 13 V4 Z"
              fill="url(#sqbar-rim)"
            />
            <path
              d="M12 3 L20 5.5 V13 C20 18.8 16 22.6 12 24.8 C8 22.6 4 18.8 4 13 V5.5 Z"
              fill="url(#sqbar-sm)"
            />
            <path
              d="M12 7 V20 M7 12 H17"
              stroke="#fff1f2"
              strokeWidth="2"
              strokeLinecap="round"
              opacity=".9"
            />
            <g clipPath="url(#sqbar-sc)">
              <rect
                className="sqbar-shine"
                x="2"
                y="-4"
                width="5"
                height="36"
                fill="#fff"
                opacity=".55"
              />
            </g>
          </svg>
          <span className="sqbar-cloth" aria-hidden="true" />
          <span className="sqbar-zz" aria-hidden="true">
            z
          </span>
        </button>
      </div>
      <div
        className={`sqbar-scroll${scrollOpen ? ' open' : ''}`}
        aria-hidden={!scrollOpen}
        style={{
          // A note's card ends at his right edge, so it never runs off the end of the bar.
          transform: note
            ? `translateX(${x + 50}px) translateX(-100%)`
            : `translateX(${x + 22}px) translateX(-50%)`,
        }}
      >
        {note ? (
          <div className="sqbar-paper sqbar-letter" role="status">
            <p>{note.text}</p>
            <div className="sqbar-letter-actions">
              <button type="button" onClick={dismiss} tabIndex={scrollOpen ? 0 : -1}>
                {note.dismissLabel}
              </button>
              {note.action &&
                ('open' in note.action ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={onOpen}
                    tabIndex={scrollOpen ? 0 : -1}
                  >
                    {note.action.label}
                  </button>
                ) : (
                  <Link
                    href={note.action.href}
                    prefetch={false}
                    className="primary"
                    onClick={dismiss}
                    tabIndex={scrollOpen ? 0 : -1}
                  >
                    {note.action.label}
                  </Link>
                ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="sqbar-paper"
            onClick={onOpen}
            tabIndex={scrollOpen ? 0 : -1}
          >
            Need a hand, my knight? Click me and ask anything
          </button>
        )}
      </div>
    </>
  );
}
