'use client';

import React, { useEffect, useRef } from 'react';
import AuthBrand from '@/components/auth/AuthBrand';
import { cn } from '@/lib/utils';

// Deterministic pseudo-random star field — seeded so the server-rendered and
// hydrated client markup match exactly (no Math.random() during render).
function generateStars(count: number) {
  let seed = 1337;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: count }, (_, i) => {
    const r = rand();
    const size = r < 0.82 ? 1 : r < 0.96 ? 1.5 : 2;
    return {
      id: i,
      top: rand() * 100,
      left: rand() * 100,
      size,
      opacity: 0.3 + rand() * 0.5,
      duration: 3 + rand() * 5,
      delay: -(rand() * 8),
    };
  });
}

// Both variants mount on every page load (each is CSS-hidden at the other's
// breakpoint), so the banner keeps a much smaller field — it is only ~164px
// tall and a full 110-star set there is pure DOM weight nobody sees.
const STARS_PANEL = generateStars(110);
const STARS_BANNER = generateStars(36);

// Pre-rendered geographically accurate continents + NASA satellite clouds,
// served as static cached assets. City lights are a separate layer so they can
// be masked to the night side only (see the lights layer below).
const CONTINENTS_IMG_URL = "url('/earth-continents.svg')";
const CITY_LIGHTS_IMG_URL = "url('/earth-city-lights.svg')";
const CLOUDS_IMG_URL = "url('/earth-clouds.webp')";

// The map textures are equirectangular 800x400. Every layer — land, lights,
// clouds — and every incident marker is positioned in this same coordinate
// space, and all of them are driven by ONE rotation clock below. That shared
// clock is what keeps markers glued to the landmass instead of drifting.
const TILE_W = 800;
const TILE_H = 400;
const CONTINENT_PERIOD_S = 55; // seconds for one full revolution of the map
const CLOUD_PERIOD_S = 68; // weather drifts slower than the surface (parallax)
const BG_POS_Y_PCT = 0; // matches backgroundPosition '0 0%' on the layers
const SPOTLIGHT_MS = 7000; // how long each incident ticket stays on screen

// Each incident walks the product's real lifecycle on a loop. The phase is
// computed in JS and is the single source of truth for the marker colour, the
// ping, the SLA ring, the pipeline strip and the clock — so the ticket can
// never disagree with the dot it's attached to.
const LIFECYCLE_S = 36;
const TRIGGERED_UNTIL_S = 9;
const ACKNOWLEDGED_UNTIL_S = 22;
const RESOLVED_UNTIL_S = 30; // 30 -> 36 is idle, then a new incident arrives

// Shared geometry for the scrolling texture strips: one tile wider than the
// globe and starting a tile to the left, so a composited translate of up to
// TILE_W always keeps the disc covered. Vertical placement (and therefore the
// '0 0%' background-position) is unchanged from a plain inset-0 layer because
// the height still matches the globe box.
const STRIP_GEOMETRY: React.CSSProperties = {
  top: 0,
  height: '100%',
  left: `${-TILE_W}px`,
  width: `calc(100% + ${TILE_W}px)`,
  backgroundRepeat: 'repeat-x',
  backgroundSize: '800px 400px',
  backgroundPosition: '0 0%',
  willChange: 'transform',
};

// Globe diameter for the desktop showcase panel. Used for both the width and
// the vertical offset so the two can never fall out of step (see the comment
// at the usage site).
const PANEL_GLOBE_WIDTH = 'clamp(520px, 62vw, 1900px)';

// SLA ring drawn around each marker (r=8 in a 22x22 box).
const SLA_RING_RADIUS = 8;
const SLA_RING_CIRCUMFERENCE = 2 * Math.PI * SLA_RING_RADIUS;

type Phase = 'triggered' | 'acknowledged' | 'resolved' | 'idle';

const IDLE_COLOR = '#475569';

const PHASE_COLOR = new Map<Phase, string>([
  ['triggered', '#ef4444'],
  ['acknowledged', '#f59e0b'],
  ['resolved', '#10b981'],
  ['idle', IDLE_COLOR],
]);

const PHASE_RANK = new Map<Phase, number>([
  ['triggered', 0],
  ['acknowledged', 1],
  ['resolved', 2],
  ['idle', 2],
]);

type IncidentMarker = {
  /** Column/row in the 800x400 equirectangular map. */
  u: number;
  v: number;
  id: string;
  service: string;
  /** Who picks it up — ownership is what separates this from a threat map. */
  responder: string;
  /** Stagger into the shared lifecycle so the globe shows a mix of states. */
  phaseOffsetS: number;
};

function phaseAt(localS: number): { phase: Phase; phaseProgress: number } {
  if (localS < TRIGGERED_UNTIL_S) {
    return { phase: 'triggered', phaseProgress: localS / TRIGGERED_UNTIL_S };
  }
  if (localS < ACKNOWLEDGED_UNTIL_S) {
    return {
      phase: 'acknowledged',
      phaseProgress: (localS - TRIGGERED_UNTIL_S) / (ACKNOWLEDGED_UNTIL_S - TRIGGERED_UNTIL_S),
    };
  }
  if (localS < RESOLVED_UNTIL_S) {
    return {
      phase: 'resolved',
      phaseProgress: (localS - ACKNOWLEDGED_UNTIL_S) / (RESOLVED_UNTIL_S - ACKNOWLEDGED_UNTIL_S),
    };
  }
  return {
    phase: 'idle',
    phaseProgress: (localS - RESOLVED_UNTIL_S) / (LIFECYCLE_S - RESOLVED_UNTIL_S),
  };
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Anchored to real city coordinates lifted from the map asset's own annotated
// light positions, so a marker always sits on land — never open ocean.
const INCIDENT_MARKERS: IncidentMarker[] = [
  {
    u: 185,
    v: 140,
    id: 'INC-2481',
    service: 'Payments API',
    responder: 'A. Fernandes',
    phaseOffsetS: 0,
  }, // New York
  {
    u: 406,
    v: 116,
    id: 'INC-3390',
    service: 'Auth Gateway',
    responder: 'M. Okafor',
    phaseOffsetS: 7.2,
  }, // London
  {
    u: 680,
    v: 126,
    id: 'INC-5127',
    service: 'Checkout Service',
    responder: 'K. Tanaka',
    phaseOffsetS: 14.4,
  }, // Tokyo
  {
    u: 562,
    v: 158,
    id: 'INC-6642',
    service: 'Notification Queue',
    responder: 'P. Sharma',
    phaseOffsetS: 21.6,
  }, // Mumbai
  {
    u: 288,
    v: 258,
    id: 'INC-7215',
    service: 'Search Cluster',
    responder: 'L. Moreira',
    phaseOffsetS: 28.8,
  }, // São Paulo
];

type NetworkRoute = {
  id: string;
  fromId: string;
  toId: string;
  color: string;
};

const NETWORK_ROUTES: NetworkRoute[] = [
  { id: 'route-ny-lon', fromId: 'INC-2481', toId: 'INC-3390', color: '#38bdf8' }, // New York -> London
  { id: 'route-lon-mum', fromId: 'INC-3390', toId: 'INC-6642', color: '#ef4444' }, // London -> Mumbai
  { id: 'route-mum-tok', fromId: 'INC-6642', toId: 'INC-5127', color: '#38bdf8' }, // Mumbai -> Tokyo
  { id: 'route-ny-sp', fromId: 'INC-2481', toId: 'INC-7215', color: '#f59e0b' }, // New York -> São Paulo
];

type LoginAnimationProps = {
  /**
   * 'panel' is the full-height desktop showcase. 'banner' is the short,
   * wide strip used above the form on small screens, where there is no room
   * for the tagline or the incident tickets.
   */
  variant?: 'panel' | 'banner';
  /**
   * Set once the user authenticates: every incident settles to resolved and
   * the routes turn green — the product's promise, in half a second.
   */
  resolved?: boolean;
};

export default function LoginAnimation({
  variant = 'panel',
  resolved = false,
}: LoginAnimationProps) {
  const isBanner = variant === 'banner';
  const globeRef = useRef<HTMLDivElement | null>(null);
  // Mirrored into a ref so the rAF loop always sees the latest value without
  // having to tear down and re-create the loop.
  const resolvedRef = useRef(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);
  const continentsRef = useRef<HTMLDivElement | null>(null);
  const lightsRef = useRef<HTMLDivElement | null>(null);
  const cloudsRef = useRef<HTMLDivElement | null>(null);
  const cloudShadowRef = useRef<HTMLDivElement | null>(null);
  const routePathsRef = useRef(new Map<string, SVGPathElement | null>());
  const routePacketsRef = useRef(new Map<string, SVGCircleElement | null>());
  // Keyed by incident id rather than array index — the rAF loop only ever
  // looks nodes up by id, so there is no positional coupling to maintain.
  // Child elements are resolved once at registration (via data-role) and
  // cached, so the loop never queries the DOM.
  type MarkerNode = {
    wrapper: HTMLDivElement;
    label: HTMLElement | null;
    ping: HTMLElement | null;
    dot: HTMLElement | null;
    ring: SVGCircleElement | null;
    clock: HTMLElement | null;
    responder: HTMLElement | null;
    stages: HTMLElement[];
    lastPhase: Phase | null;
    lastClock: string;
    lastResponder: string;
  };

  const nodesRef = useRef(new Map<string, MarkerNode>());

  const registerMarker = (id: string, el: HTMLDivElement | null): void => {
    if (!el) {
      nodesRef.current.delete(id);
      return;
    }
    nodesRef.current.set(id, {
      wrapper: el,
      label: el.querySelector<HTMLElement>('[data-role="label"]'),
      ping: el.querySelector<HTMLElement>('[data-role="ping"]'),
      dot: el.querySelector<HTMLElement>('[data-role="dot"]'),
      ring: el.querySelector<SVGCircleElement>('[data-role="ring"]'),
      clock: el.querySelector<HTMLElement>('[data-role="clock"]'),
      responder: el.querySelector<HTMLElement>('[data-role="responder"]'),
      stages: Array.from(el.querySelectorAll<HTMLElement>('[data-stage]')),
      lastPhase: null,
      lastClock: '',
      lastResponder: '',
    });
  };

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let boxW = globe.clientWidth;
    const resizeObserver = new ResizeObserver(() => {
      boxW = globe.clientWidth;
    });
    resizeObserver.observe(globe);

    // Each texture strip is one tile wider than the globe and starts shifted a
    // full tile to the left, so translating right by up to TILE_W always keeps
    // the disc covered. Transforms are composited, so this costs no repaint —
    // unlike writing background-position every frame across four large layers.
    const scrollStrip = (el: HTMLDivElement | null, offset: number) => {
      if (!el) return;
      el.style.transform = `translate3d(${offset % TILE_W}px, 0, 0)`;
    };

    let rafId = 0;
    let startTs = 0;
    let spotlightId: string | null = null;
    let nextSpotlightAt = 0;

    const frame = (now: number) => {
      // Hidden (e.g. the desktop panel while on a phone) — nothing to lay out,
      // and dividing by a zero-width box would produce NaN positions.
      if (boxW <= 0) {
        if (!prefersReducedMotion) rafId = requestAnimationFrame(frame);
        return;
      }

      if (!startTs) startTs = now;
      // Under reduced motion we render a single frozen frame. Use a non-zero
      // pseudo-time so the globe still shows a believable mix of lifecycle
      // states rather than every incident sitting at 00:00 "triggered".
      const elapsed = prefersReducedMotion ? 12 : (now - startTs) / 1000;

      // One clock → every layer and every marker derive from this.
      const surfaceOffset = (elapsed / CONTINENT_PERIOD_S) * TILE_W;
      const cloudOffset = (elapsed / CLOUD_PERIOD_S) * TILE_W;

      scrollStrip(continentsRef.current, surfaceOffset);
      // Lights share the surface offset exactly — they must stay on their cities.
      scrollStrip(lightsRef.current, surfaceOffset);
      scrollStrip(cloudsRef.current, cloudOffset);
      scrollStrip(cloudShadowRef.current, cloudOffset);

      const radius = boxW / 2;
      const centreX = boxW / 2;
      const centreY = boxW / 2;
      // background-position-y percentages resolve against (box height - image height)
      const yOffset = (boxW - TILE_H) * BG_POS_Y_PCT;

      const placements = new Map<string, { bx: number; by: number; alpha: number; phase: Phase }>();

      for (const m of INCIDENT_MARKERS) {
        const bx = (((m.u + surfaceOffset) % TILE_W) + TILE_W) % TILE_W;
        const by = m.v + yOffset;
        let alpha = 0;
        if (bx <= boxW) {
          const dist = Math.hypot(bx - centreX, by - centreY);
          // Fade out across the outer 14% of the disc so markers dissolve at
          // the limb as they rotate out of view rather than popping off.
          alpha = Math.max(0, Math.min(1, (radius - dist) / (radius * 0.14)));
        }

        // Where this incident is in its lifecycle right now. Once the user is
        // authenticated we settle every incident to resolved — "you're in,
        // everything is handled".
        const localS = (elapsed + m.phaseOffsetS) % LIFECYCLE_S;
        const natural = phaseAt(localS);
        const allClear = resolvedRef.current;
        const phase: Phase = allClear ? 'resolved' : natural.phase;
        const phaseProgress = allClear ? 1 : natural.phaseProgress;
        const colour = PHASE_COLOR.get(phase) ?? IDLE_COLOR;

        placements.set(m.id, { bx, by, alpha, phase });

        const node = nodesRef.current.get(m.id);
        if (!node) continue;

        node.wrapper.style.opacity = String(alpha);
        node.wrapper.style.transform = `translate3d(${bx}px, ${by}px, 0)`;

        if (node.dot) {
          node.dot.style.backgroundColor = colour;
          node.dot.style.boxShadow = phase === 'idle' ? 'none' : `0 0 8px 1px ${colour}b3`;
        }

        // One-shot "arrived" ping over the first slice of the triggered phase.
        if (node.ping) {
          const pingT = phase === 'triggered' ? Math.min(1, phaseProgress / 0.22) : 1;
          const showPing = phase === 'triggered' && pingT < 1;
          node.ping.style.opacity = showPing ? String(0.7 * (1 - pingT)) : '0';
          node.ping.style.transform = `scale(${0.5 + pingT * 1.9})`;
        }

        // SLA ring: burns down while a clock is actually running against this
        // incident (awaiting ack, then awaiting resolve). Hidden once resolved.
        if (node.ring) {
          const running = phase === 'triggered' || phase === 'acknowledged';
          node.ring.style.opacity = running ? '0.9' : '0';
          if (running) {
            node.ring.style.stroke = colour;
            node.ring.style.strokeDashoffset = String(SLA_RING_CIRCUMFERENCE * phaseProgress);
          }
        }

        // Elapsed since this incident triggered — honest real-time seconds.
        if (node.clock) {
          const shown = formatClock(Math.min(localS, RESOLVED_UNTIL_S));
          if (shown !== node.lastClock) {
            node.clock.textContent = shown;
            node.lastClock = shown;
          }
          node.clock.style.color = colour;
        }

        // Ownership line — the beat that makes this incident response rather
        // than a threat map: paged -> picked up by a person -> resolved.
        if (node.responder) {
          const line =
            phase === 'triggered'
              ? 'Paging on-call…'
              : phase === 'acknowledged'
                ? `${m.responder} acknowledged`
                : phase === 'resolved'
                  ? `${m.responder} resolved`
                  : 'Monitoring — all clear';
          if (line !== node.lastResponder) {
            node.responder.textContent = line;
            node.lastResponder = line;
          }
        }

        // Pipeline: three tiny dots. Steps already passed stay filled, the
        // current step takes the phase colour, upcoming steps stay dim — the
        // whole lifecycle in ~20px of width instead of a row of words.
        if (node.lastPhase !== phase) {
          const rank = PHASE_RANK.get(phase) ?? 0;
          for (const stageEl of node.stages) {
            const stageRank = Number(stageEl.dataset.rank ?? '0');
            const isActive = stageRank === rank && phase !== 'idle';
            stageEl.style.backgroundColor = isActive
              ? colour
              : stageRank < rank
                ? '#94a3b8'
                : '#334155';
            stageEl.style.transform = isActive ? 'scale(1.5)' : 'scale(1)';
          }
          node.lastPhase = phase;
        }
      }

      // Spotlight: exactly one incident ticket visible at a time, on a marker
      // sitting comfortably inside the disc (never out at the limb) and not
      // dormant — a dormant marker has no story to tell.
      const isWellPlaced = (id: string) => {
        const p = placements.get(id);
        return (
          !!p && p.alpha >= 1 && p.bx > boxW * 0.18 && p.bx < boxW * 0.82 && p.phase !== 'idle'
        );
      };

      if (now >= nextSpotlightAt) {
        const currentIdx = INCIDENT_MARKERS.findIndex(m => m.id === spotlightId);
        // Rotate the candidate order so we always advance to the *next* marker.
        const order = [
          ...INCIDENT_MARKERS.slice(currentIdx + 1),
          ...INCIDENT_MARKERS.slice(0, currentIdx + 1),
        ];
        const next = order.find(m => isWellPlaced(m.id));
        if (next) {
          spotlightId = next.id;
          nextSpotlightAt = now + SPOTLIGHT_MS;
        }
      }

      for (const m of INCIDENT_MARKERS) {
        const node = nodesRef.current.get(m.id);
        if (!node?.label) continue;
        const visible = m.id === spotlightId && (placements.get(m.id)?.alpha ?? 0) >= 1;
        node.label.style.opacity = visible ? '1' : '0';
      }

      // Dynamic network routes between cities — locked to the rotating globe surface
      for (const [i, route] of NETWORK_ROUTES.entries()) {
        const p1 = placements.get(route.fromId);
        const p2 = placements.get(route.toId);
        const pathEl = routePathsRef.current.get(route.id);
        const packetEl = routePacketsRef.current.get(route.id);

        if (!p1 || !p2 || !pathEl || !packetEl) continue;

        const dx = p2.bx - p1.bx;
        const dy = p2.by - p1.by;
        const dist = Math.hypot(dx, dy);

        // Both cities must be visible on the same cylindrical wrap without crossing seam
        const wrappedSeam = Math.abs(dx) > TILE_W * 0.45;
        const routeAlpha = Math.min(p1.alpha, p2.alpha);

        if (!wrappedSeam && routeAlpha > 0.05 && dist > 15 && dist < boxW * 0.72) {
          const mx = (p1.bx + p2.bx) / 2;
          const my = (p1.by + p2.by) / 2;
          // Arch upward towards space
          const arch = Math.min(46, dist * 0.22);
          const cpx = mx;
          const cpy = my - arch;

          pathEl.setAttribute(
            'd',
            `M ${p1.bx.toFixed(1)},${p1.by.toFixed(1)} Q ${cpx.toFixed(1)},${cpy.toFixed(1)} ${p2.bx.toFixed(1)},${p2.by.toFixed(1)}`
          );
          // On successful sign-in every route reads "all clear".
          const allClear = resolvedRef.current;
          const routeColour = allClear ? '#10b981' : route.color;
          pathEl.style.stroke = routeColour;
          packetEl.style.fill = routeColour;
          pathEl.style.opacity = String(routeAlpha * (allClear ? 1 : 0.75));

          // Animated pulse packet bead traveling along the curve
          const speed = 0.0007;
          const t = (now * speed + i * 0.25) % 1;
          const omt = 1 - t;
          const px = omt * omt * p1.bx + 2 * omt * t * cpx + t * t * p2.bx;
          const py = omt * omt * p1.by + 2 * omt * t * cpy + t * t * p2.by;

          packetEl.setAttribute('cx', px.toFixed(1));
          packetEl.setAttribute('cy', py.toFixed(1));
          packetEl.style.opacity = String(routeAlpha * 0.95);
        } else {
          pathEl.style.opacity = '0';
          packetEl.style.opacity = '0';
        }
      }

      if (!prefersReducedMotion) rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#04060d] select-none">
      {/* Starfield */}
      <div className="absolute inset-0" aria-hidden="true">
        {(isBanner ? STARS_BANNER : STARS_PANEL).map(s => (
          <span
            key={s.id}
            className="absolute rounded-full bg-white"
            style={{
              top: `${s.top}%`,
              left: `${s.left}%`,
              width: s.size,
              height: s.size,
              opacity: s.opacity,
              animation: `twinkle ${s.duration}s ease-in-out infinite`,
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}

        {/* Shooting stars — more frequent, varied trajectories */}
        <span
          className="absolute h-px w-28 rounded-full bg-gradient-to-r from-white to-transparent opacity-0"
          style={{
            top: '14%',
            left: '72%',
            transform: 'rotate(28deg)',
            animation: 'shooting-star 10s linear infinite',
            animationDelay: '-1s',
          }}
        />
        <span
          className="absolute h-px w-20 rounded-full bg-gradient-to-r from-white to-transparent opacity-0"
          style={{
            top: '36%',
            left: '18%',
            transform: 'rotate(24deg)',
            animation: 'shooting-star 13s linear infinite',
            animationDelay: '-7s',
          }}
        />
        <span
          className="absolute h-px w-32 rounded-full bg-gradient-to-r from-slate-200 to-transparent opacity-0"
          style={{
            top: '8%',
            left: '45%',
            transform: 'rotate(32deg)',
            animation: 'shooting-star 16s linear infinite',
            animationDelay: '-4s',
          }}
        />
        <span
          className="absolute h-px w-16 rounded-full bg-gradient-to-r from-white to-transparent opacity-0"
          style={{
            top: '55%',
            left: '60%',
            transform: 'rotate(20deg)',
            animation: 'shooting-star 11s linear infinite',
            animationDelay: '-9s',
          }}
        />
        <span
          className="absolute h-px w-24 rounded-full bg-gradient-to-r from-blue-100 to-transparent opacity-0"
          style={{
            top: '25%',
            left: '10%',
            transform: 'rotate(30deg)',
            animation: 'shooting-star 17s linear infinite',
            animationDelay: '-14s',
          }}
        />
      </div>

      {/* Soft depth vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(59,70,130,0.22),transparent_60%)]" />

      {/* Top brand header — in banner mode the form below already shows the
          brand, so keep the strip pure imagery. */}
      <div
        className={cn(
          'relative z-20 flex items-center justify-between p-8 lg:p-10 2xl:p-14 pb-0',
          isBanner && 'hidden'
        )}
      >
        <AuthBrand tone="onDark" />
      </div>

      {/* Earth + orbit, anchored toward the bottom so it reads as a planetary
          horizon. Hidden from assistive tech: the incident tickets are
          illustrative sample data, not real content to announce. */}
      <div
        className="absolute left-1/2 z-10 pointer-events-none"
        aria-hidden="true"
        style={{
          // A percentage `bottom` resolves against the PANEL height, while the
          // globe is sized from viewport width — so on a tall display the two
          // drift apart and the globe grows from 53% of the frame to 64%,
          // reading as half a planet rather than a horizon. Deriving the offset
          // from the same expression that sizes the globe keeps the visible arc
          // at a constant ~53% of the panel height on every screen.
          bottom: isBanner ? '-150%' : `calc(53vh - ${PANEL_GLOBE_WIDTH})`,
          width: isBanner ? 'min(1400px, 190vw)' : PANEL_GLOBE_WIDTH,
          aspectRatio: '1 / 1',
          transform: 'translateX(-50%)',
        }}
      >
        {/* Orbit ring + satellites */}
        <div
          className="absolute rounded-full border border-dashed border-indigo-300/20"
          style={{ inset: '-6%' }}
        />
        <div
          className="absolute inset-0 animate-[spin_50s_linear_infinite]"
          style={{ margin: '-6%' }}
        >
          <span className="absolute top-0 left-1/2 -translate-x-1/2 h-2 w-2 rounded-full bg-sky-200 shadow-[0_0_10px_3px_rgba(186,230,253,0.6)]" />
        </div>
        <div
          className="absolute inset-0 animate-[spin_78s_linear_infinite]"
          style={{ margin: '-6%', animationDirection: 'reverse' }}
        >
          <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1.5 w-1.5 rounded-full bg-red-300/80 shadow-[0_0_8px_2px_rgba(252,165,165,0.5)]" />
        </div>

        {/* Outer Rayleigh Atmospheric Aura */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            margin: '-4%',
            background:
              'radial-gradient(circle at 35% 30%, rgba(56,189,248,0.22) 50%, rgba(14,165,233,0.08) 68%, transparent 76%)',
            filter: 'blur(20px)',
          }}
        />

        {/* The globe itself */}
        <div
          ref={globeRef}
          className="absolute inset-0 rounded-full overflow-hidden"
          style={{
            boxShadow:
              '0 0 75px 10px rgba(56,189,248,0.32), 0 0 0 1.5px rgba(186,230,253,0.28), inset 0 0 60px rgba(0,0,0,0.6)',
          }}
        >
          {/* Ocean base — realistic deep satellite ocean */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 35% 30%, #175472 0%, #0c334b 35%, #071e30 65%, #030c16 100%)',
            }}
          />
          {/* Rotating continents strip. Each texture layer is one tile wider
              than the globe and starts a tile to the left, so it can be
              scrolled with a composited transform instead of repainting
              background-position every frame. */}
          <div
            ref={continentsRef}
            className="absolute opacity-90 pointer-events-none"
            style={{ ...STRIP_GEOMETRY, backgroundImage: CONTINENTS_IMG_URL }}
          />
          {/* City lights — same offset as the land so they stay on their cities.
              The night-side mask lives on a wrapper that matches the globe box,
              because its percentages would otherwise resolve against the much
              wider scrolling strip. */}
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none mix-blend-screen"
            style={{
              WebkitMaskImage:
                'radial-gradient(circle at 32% 28%, transparent 42%, rgba(0,0,0,0.5) 64%, #000 84%)',
              maskImage:
                'radial-gradient(circle at 32% 28%, transparent 42%, rgba(0,0,0,0.5) 64%, #000 84%)',
            }}
          >
            <div
              ref={lightsRef}
              className="absolute"
              style={{
                ...STRIP_GEOMETRY,
                backgroundImage: CITY_LIGHTS_IMG_URL,
                filter: 'drop-shadow(0 0 2px rgba(255,190,120,0.85))',
              }}
            />
          </div>
          {/* Cloud altitude shadow on terrain & ocean (sun angle from top-left).
              The 2.5/3.5px offset is baked into the strip's position so the
              transform stays free for scrolling. */}
          <div
            ref={cloudShadowRef}
            className="absolute opacity-30 pointer-events-none mix-blend-multiply"
            style={{
              ...STRIP_GEOMETRY,
              left: `calc(${-TILE_W}px + 2.5px)`,
              top: '3.5px',
              backgroundImage: CLOUDS_IMG_URL,
              filter: 'brightness(0) blur(2px)',
            }}
          />
          {/* NASA Photographic Satellite Cloud Systems */}
          <div
            ref={cloudsRef}
            className="absolute opacity-85 mix-blend-screen pointer-events-none"
            style={{ ...STRIP_GEOMETRY, backgroundImage: CLOUDS_IMG_URL }}
          />
          {/* Dynamic rotating network routes — locked to cities as the Earth spins */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none mix-blend-screen overflow-visible">
            {NETWORK_ROUTES.map(route => (
              <g key={route.id}>
                <path
                  ref={el => {
                    routePathsRef.current.set(route.id, el);
                  }}
                  fill="none"
                  stroke={route.color}
                  strokeWidth="1.6"
                  strokeDasharray="4 4"
                  opacity="0"
                />
                <circle
                  ref={el => {
                    routePacketsRef.current.set(route.id, el);
                  }}
                  r="2.5"
                  fill={route.color}
                  opacity="0"
                  style={{ filter: `drop-shadow(0 0 4px ${route.color})` }}
                />
              </g>
            ))}
          </svg>
          {/* Volumetric shading — deep night terminator shadow */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 74% 78%, rgba(2,5,10,0.85) 0%, rgba(2,5,10,0.45) 45%, transparent 72%)',
            }}
          />
          {/* Liquid ocean sun-glint specular reflection */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none mix-blend-screen"
            style={{
              background:
                'radial-gradient(ellipse at 32% 28%, rgba(255,255,255,0.4) 0%, rgba(186,230,253,0.18) 16%, transparent 36%)',
            }}
          />
          {/* Rayleigh limb scattering ring */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                'radial-gradient(circle at 35% 30%, transparent 62%, rgba(56,189,248,0.15) 86%, rgba(186,230,253,0.38) 97%, transparent 100%)',
            }}
          />
          {/* Arctic polar atmospheric limb */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse 70% 30% at 50% 0%, rgba(224,242,254,0.35) 0%, rgba(56,189,248,0.15) 50%, transparent 80%)',
            }}
          />
          {/* Terminator rim light */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              boxShadow:
                'inset 8px -8px 42px rgba(0,0,0,0.7), inset -5px 5px 34px rgba(186,230,253,0.35)',
            }}
          />
          {/* Incident markers — pinned to map coordinates, so they ride the
              surface as it rotates and dissolve at the limb. */}
          {INCIDENT_MARKERS.map(m => (
            <div
              key={m.id}
              ref={el => registerMarker(m.id, el)}
              className="absolute top-0 left-0 opacity-0"
              style={{ willChange: 'transform, opacity' }}
            >
              {/* "just arrived" ping, fired at the start of the triggered phase */}
              <span
                data-role="ping"
                className="absolute rounded-full bg-red-500 opacity-0"
                style={{ left: -9, top: -9, width: 18, height: 18 }}
              />

              {/* SLA ring — depletes while a clock is running on this incident */}
              <svg
                className="absolute pointer-events-none"
                width="22"
                height="22"
                style={{ left: -11, top: -11, transform: 'rotate(-90deg)' }}
                aria-hidden="true"
              >
                <circle
                  data-role="ring"
                  cx="11"
                  cy="11"
                  r={SLA_RING_RADIUS}
                  fill="none"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeDasharray={SLA_RING_CIRCUMFERENCE}
                  strokeDashoffset={0}
                  className="opacity-0"
                />
              </svg>

              {/* the marker dot — colour is driven by the lifecycle phase */}
              <span
                data-role="dot"
                className="absolute rounded-full"
                style={{ left: -3, top: -3, width: 6, height: 6, backgroundColor: '#475569' }}
              />

              {/* Ticket callout — tracks its marker; only one is shown at a
                  time. Omitted in banner mode: the strip is too short to give
                  a ticket room without covering the planet. */}
              <div
                data-role="label"
                className={cn(
                  'absolute whitespace-nowrap rounded border border-white/10 bg-[#0a0e18]/95 px-2 py-1 shadow-lg opacity-0',
                  isBanner && 'hidden'
                )}
                style={{
                  left: 0,
                  bottom: 16,
                  transform: 'translateX(-50%)',
                  transition: 'opacity 600ms ease',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-tight text-white leading-none">
                    {m.id}
                  </span>
                  {/* lifecycle as three dots: passed / current / upcoming */}
                  <span className="flex items-center gap-[3px]">
                    <span
                      data-stage
                      data-rank="0"
                      className="block h-[3px] w-[3px] rounded-full transition-transform"
                      style={{ backgroundColor: '#334155' }}
                    />
                    <span
                      data-stage
                      data-rank="1"
                      className="block h-[3px] w-[3px] rounded-full transition-transform"
                      style={{ backgroundColor: '#334155' }}
                    />
                    <span
                      data-stage
                      data-rank="2"
                      className="block h-[3px] w-[3px] rounded-full transition-transform"
                      style={{ backgroundColor: '#334155' }}
                    />
                  </span>
                  <span
                    data-role="clock"
                    className="text-[11px] tabular-nums font-semibold leading-none ml-auto"
                  >
                    00:00
                  </span>
                </div>
                <div className="text-[10px] leading-tight mt-1.5 text-slate-500">
                  {m.service}
                  <span className="mx-1 text-slate-700">·</span>
                  <span data-role="responder" className="text-slate-400">
                    Paging on-call…
                  </span>
                </div>

                <div
                  className="absolute left-1/2 top-full -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent"
                  style={{ borderTopColor: '#0a0e18' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom tagline */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 p-8 lg:p-12 2xl:p-16 pt-24 bg-gradient-to-t from-[#04060d] via-[#04060d]/85 to-transparent',
          isBanner && 'hidden'
        )}
      >
        <div className="w-7 h-[2px] bg-red-600 mb-3" />
        <h2 className="text-3xl lg:text-4xl 2xl:text-5xl min-[2000px]:text-6xl font-extrabold text-white tracking-tight leading-[1.2]">
          You are not{' '}
          <span className="text-red-500">
            the only one awake.
          </span>
        </h2>
        <p className="text-xs lg:text-sm 2xl:text-base text-slate-400 mt-2 max-w-sm 2xl:max-w-md leading-relaxed">
          Alerts reach the right responder in seconds.
        </p>

        <div className="flex items-center justify-between pt-4 mt-5 2xl:mt-7 border-t border-slate-800/60 text-[10px] 2xl:text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          <div>Open source &nbsp;•&nbsp; Self-hosted</div>
          <div>EVERY ALERT HAS AN OWNER</div>
        </div>
      </div>
    </div>
  );
}
