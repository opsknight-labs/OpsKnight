/**
 * The one stylesheet for the public status page.
 *
 * Authored entirely as descendant selectors under a single root class, because the same string has
 * to work in two places: the document, where the live page renders, and the admin preview's shadow
 * root, where selector-matched rules from the page's stylesheets never reach. Custom properties do
 * inherit across a shadow boundary, but `.some-class { ... }` defined outside does not, which is
 * why preview and live must share this text rather than each having their own.
 *
 * Consequences worth knowing before editing:
 *   - no Tailwind utilities in the public components; they would silently vanish in preview
 *   - no `:host`; it matches only inside a shadow root and would break the live page
 *   - every colour comes from a token defined on the root class, so branding can override it
 *   - custom CSS / templates load after this file and may use !important
 *
 * Stable hooks for custom CSS and future templates (do not rename without a template migration):
 *   .status-page-container  page shell (live document + preview frame)
 *   .status-page-surface    token root for the shared stylesheet
 *   .status-page-header     top bar (also .status-topbar)
 *   .status-v3-hero         overall status banner
 *   .status-service-card    service row (also .status-v3-service)
 *   .status-v3-history      90-day bars — templates should not restyle these
 *   .status-incident-card   incident row (also .status-v3-incident)
 *   footer / .status-site-footer
 *   tokens: --status-* and --sp-*
 */
export const STATUS_PAGE_SURFACE_CLASS = 'status-page-surface';

const R = `.${STATUS_PAGE_SURFACE_CLASS}`;

export const STATUS_PAGE_PUBLIC_CSS = `
${R} {
  --status-operational: #047857;
  --status-operational-bg: #ecfdf5;
  --status-degraded: #b45309;
  --status-degraded-bg: #fffbeb;
  --status-maintenance: #1d4ed8;
  --status-maintenance-bg: #eff6ff;
  --status-partial-outage: #c2410c;
  --status-partial-outage-bg: #fff7ed;
  --status-major-outage: #be123c;
  --status-major-outage-bg: #fff1f2;
  --status-unknown: #475569;
  --status-unknown-bg: #f1f5f9;
  --primary: var(--status-primary, var(--primary-color, #2563eb));
  --primary-hover: var(--status-primary-hover, var(--primary-hover, #1d4ed8));
  --status-text: var(--sp-ink, #111827);
  --status-text-strong: var(--sp-ink-strong, var(--sp-ink, #0f172a));
  --status-text-muted: var(--sp-muted, #6b7280);
  --status-text-subtle: var(--sp-muted-2, var(--sp-muted, #94a3b8));
  --status-text-inverse: var(--sp-inverse, #ffffff);
  --status-panel-bg: var(--sp-panel-bg, #ffffff);
  --status-panel-border: var(--sp-panel-border, #e2e8f0);
  --status-panel-muted-bg: var(--sp-panel-muted-bg, #f8fafc);
  --status-panel-muted-border: var(--sp-panel-muted-border, #e2e8f0);
  color: var(--status-text);
  font-family: var(--status-font-family, inherit);
  display: block;
  inline-size: 100%; max-inline-size: 100%; min-inline-size: 0;
}

${R} *, ${R} *::before, ${R} *::after { box-sizing: border-box; }
${R} img, ${R} svg, ${R} video { max-inline-size: 100%; }
${R} .status-page-content { inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; }
${R} h1, ${R} h2, ${R} h3, ${R} h4 { font-family: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif; }
${R} h1, ${R} h2, ${R} h3, ${R} h4, ${R} p, ${R} dl, ${R} dd, ${R} dt { margin: 0; }
${R} button, ${R} input, ${R} select { color: inherit; font: inherit; }

${R} .sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* ---- status tokens ---- */
${R} .status-operational { color: var(--status-operational); background: var(--status-operational-bg); }
${R} .status-degraded { color: var(--status-degraded); background: var(--status-degraded-bg); }
${R} .status-maintenance { color: var(--status-maintenance); background: var(--status-maintenance-bg); }
${R} .status-partial-outage { color: var(--status-partial-outage); background: var(--status-partial-outage-bg); }
${R} .status-major-outage { color: var(--status-major-outage); background: var(--status-major-outage-bg); }
${R} .status-unknown { color: var(--status-unknown); background: var(--status-unknown-bg); }

/* ---- status tokens & central badge engine ---- */
${R} .status-badge,
${R} [data-badge="true"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border-radius: 0.375rem;
  padding: 0.2rem 0.55rem;
  font-weight: 700;
  font-size: 0.6875rem;
  line-height: 1.25;
  white-space: nowrap;
  letter-spacing: 0.04em;
  color: #ffffff !important;
  border: 1px solid transparent !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  transition: all 0.15s ease;
}
${R} .status-badge.status-v3-badge--xs,
${R} [data-badge="true"][data-size="xs"] {
  font-size: 0.625rem;
  padding: 0.125rem 0.45rem;
  border-radius: 0.3125rem;
}
${R} .status-badge.status-v3-badge--sm,
${R} [data-badge="true"][data-size="sm"] {
  font-size: 0.6875rem;
  padding: 0.2rem 0.55rem;
  border-radius: 0.375rem;
}
${R} .status-badge.status-v3-badge--md,
${R} [data-badge="true"][data-size="md"] {
  font-size: 0.75rem;
  padding: 0.25rem 0.65rem;
  border-radius: 0.375rem;
}
${R} .status-badge .status-badge__dot,
${R} [data-badge="true"] .status-badge__dot {
  width: 0.425rem;
  height: 0.425rem;
  border-radius: 9999px;
  background-color: #ffffff !important;
  flex-shrink: 0;
  display: inline-block;
  opacity: 0.95;
}
${R} .status-badge.status-operational,
${R} .status-badge.status-resolved,
${R} .status-badge.status-completed,
${R} .status-badge.status-excellent,
${R} [data-badge="true"][data-variant="success"],
${R} [data-badge="true"][data-status="operational"],
${R} [data-badge="true"][data-status="resolved"],
${R} [data-badge="true"][data-status="completed"],
${R} [data-badge="true"][data-status="excellent"] {
  background: linear-gradient(to right, #10b981, #16a34a) !important;
  color: #ffffff !important;
}
${R} .status-badge.status-degraded,
${R} .status-badge.status-partial-outage,
${R} .status-badge.status-acknowledged,
${R} .status-badge.status-in-progress,
${R} .status-badge.status-good,
${R} .status-badge.status-medium,
${R} [data-badge="true"][data-variant="warning"],
${R} [data-badge="true"][data-status="degraded"],
${R} [data-badge="true"][data-status="partial-outage"],
${R} [data-badge="true"][data-status="acknowledged"],
${R} [data-badge="true"][data-status="in-progress"],
${R} [data-badge="true"][data-status="good"],
${R} [data-badge="true"][data-status="medium"] {
  background: linear-gradient(to right, #f59e0b, #ea580c) !important;
  color: #ffffff !important;
}
${R} .status-badge.status-maintenance,
${R} .status-badge.status-scheduled,
${R} .status-badge.status-update,
${R} .status-badge.status-low,
${R} [data-badge="true"][data-variant="info"],
${R} [data-badge="true"][data-status="maintenance"],
${R} [data-badge="true"][data-status="scheduled"],
${R} [data-badge="true"][data-status="update"],
${R} [data-badge="true"][data-status="low"] {
  background: linear-gradient(to right, #3b82f6, #4f46e5) !important;
  color: #ffffff !important;
}
${R} .status-badge.status-major-outage,
${R} .status-badge.status-critical,
${R} .status-badge.status-high,
${R} .status-badge.status-open,
${R} .status-badge.status-below-target,
${R} .status-badge.status-poor,
${R} [data-badge="true"][data-variant="danger"],
${R} [data-badge="true"][data-status="major-outage"],
${R} [data-badge="true"][data-status="critical"],
${R} [data-badge="true"][data-status="high"],
${R} [data-badge="true"][data-status="open"],
${R} [data-badge="true"][data-status="below-target"],
${R} [data-badge="true"][data-status="poor"] {
  background: linear-gradient(to right, #ef4444, #e11d48) !important;
  color: #ffffff !important;
}
${R} .status-badge.status-unknown,
${R} [data-badge="true"][data-variant="neutral"],
${R} [data-badge="true"][data-status="unknown"] {
  background: #334155 !important;
  color: #ffffff !important;
}
${R} .status-v3-update .status-badge {
  justify-self: start;
}

/* ---- shared surfaces ---- */
${R} .status-panel {
  padding: clamp(1.25rem, 2.5vw, 1.75rem); border: 1px solid var(--status-panel-border);
  border-radius: 1rem; background: var(--status-panel-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 10px 30px rgba(15, 23, 42, .035);
}
${R} .status-section { margin: clamp(2.75rem, 6vw, 4.5rem) 0; display: grid; gap: 1.25rem; min-inline-size: 0; max-inline-size: 100%; }
${R} .status-section__head {
  display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: .5rem;
}
${R} .status-section__head h2 { font-size: clamp(1.25rem, 2vw, 1.5rem); font-weight: 750; letter-spacing: -.02em; color: var(--status-text-strong); }
${R} .status-section__count { font-size: .8125rem; color: var(--status-text-muted); }
${R} .status-muted { color: var(--status-text-muted); font-size: .875rem; }
${R} .status-empty {
  display: grid; gap: .35rem; padding: 2rem 1.25rem; text-align: center;
  border: 1px dashed var(--status-panel-muted-border); border-radius: .875rem;
  background: var(--status-panel-muted-bg);
}
${R} .status-empty strong { color: var(--status-text-strong); }

/* ---- overview ---- */
${R} .status-overview { display: grid; gap: 1rem; margin: 1.5rem 0 2rem; }
${R} .status-overview__banner { display: grid; gap: .35rem; }
${R} .status-overview__banner h2 {
  font-size: clamp(1.375rem, 4vw, 1.75rem); font-weight: 750; letter-spacing: -.01em;
  color: var(--status-text-strong);
}
${R} .status-overview__note {
  display: inline-flex; align-items: center; gap: .4rem; padding: .35rem .6rem;
  border-radius: .5rem; background: var(--status-unknown-bg); color: var(--status-unknown);
  font-size: .8125rem; font-weight: 600;
}
${R} .status-overview__stats {
  display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}
${R} .status-stat { display: grid; gap: .2rem; align-content: start; }
${R} .status-stat__label {
  font-size: .6875rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--status-text-subtle);
}
${R} .status-stat__value {
  font-size: 1.5rem; font-weight: 700; line-height: 1.1; color: var(--status-text-strong);
  font-variant-numeric: tabular-nums;
}
${R} .status-stat__hint { font-size: .8125rem; color: var(--status-text-muted); }

/* ---- service toolbar ---- */
${R} .status-toolbar { display: grid; gap: .75rem; }
${R} .status-toolbar__row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
${R} .status-toolbar__search { flex: 1 1 16rem; min-width: 0; }
${R} .status-input {
  width: 100%; padding: .5rem .75rem; border: 1px solid var(--status-panel-border);
  border-radius: .5rem; background: var(--status-panel-bg); color: var(--status-text);
}
${R} .status-input:focus-visible {
  outline: none; border-color: var(--primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 18%, transparent);
}
${R} .status-chip {
  display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .7rem;
  border: 1px solid var(--status-panel-border); border-radius: 999px;
  background: var(--status-panel-bg); color: var(--status-text-muted);
  font-size: .8125rem; font-weight: 600; cursor: pointer;
}
${R} .status-chip:hover:not(:disabled) { border-color: var(--primary); color: var(--status-text-strong); }
${R} .status-chip:focus-visible {
  outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent);
}
${R} .status-chip[aria-pressed='true'] {
  border-color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent);
  color: var(--status-text-strong);
}
${R} .status-chip:disabled { opacity: .45; cursor: not-allowed; }
${R} .status-chip__count { font-variant-numeric: tabular-nums; opacity: .75; }

/* ---- services ---- */
${R} .status-services {
  display: grid; gap: 0; min-width: 0; width: 100%;
  border: 1px solid var(--status-panel-border); border-radius: 1rem;
  background: var(--status-panel-bg); box-shadow: 0 1px 3px rgba(15, 23, 42, .05);
  overflow: visible;
}
${R} .status-region-group { display: grid; gap: .75rem; margin: 0 0 1.25rem; min-inline-size: 0; max-inline-size: 100%; }
${R} .status-region-group > h3 {
  font-size: .75rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--status-text-subtle);
}
${R} .status-service {
  content-visibility: auto; contain-intrinsic-size: auto 148px;
  position: relative; display: grid; gap: 1rem; padding: clamp(1rem, 3vw, 1.5rem);
  border: 0; border-top: 1px solid var(--status-panel-border); border-radius: 0;
  background: var(--status-panel-bg); box-shadow: none;
  transition: transform .2s ease, box-shadow .2s ease, border-color .2s ease;
  overflow: visible;
  min-width: 0; width: 100%; max-width: 100%;
}
${R} .status-service:first-child { border-top: 0; border-radius: 1rem 1rem 0 0; }
${R} .status-service:last-child { border-radius: 0 0 1rem 1rem; }
${R} .status-service:only-child { border-radius: 1rem; }
${R} .status-service::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; border-radius: 0; background: transparent; }
${R} .status-service:hover, ${R} .status-service:focus-within {
  background: color-mix(in srgb, var(--status-panel-bg) 96%, var(--primary) 4%);
  transform: translateX(2px); box-shadow: none; z-index: 10;
}
${R} .status-service:hover::before, ${R} .status-service:focus-within::before { background: var(--status-operational); }
${R} .status-service[data-status='degraded']:hover::before, ${R} .status-service[data-status='degraded']:focus-within::before { background: var(--status-degraded); }
${R} .status-service[data-status='maintenance']:hover::before, ${R} .status-service[data-status='maintenance']:focus-within::before { background: var(--status-maintenance); }
${R} .status-service[data-status='partial-outage']:hover::before, ${R} .status-service[data-status='partial-outage']:focus-within::before { background: var(--status-partial-outage); }
${R} .status-service[data-status='major-outage']:hover::before, ${R} .status-service[data-status='major-outage']:focus-within::before { background: var(--status-major-outage); }
${R} .status-service__head {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: .75rem; min-inline-size: 0;
}
${R} .status-service__head > div { min-inline-size: 0; }
${R} .status-service__name { font-size: 1.0625rem; font-weight: 750; letter-spacing: -.01em; color: var(--status-text-strong); }
${R} .status-service__meta { display: flex; flex-wrap: wrap; gap: .375rem; margin-top: .35rem; }
${R} .status-tag {
  display: inline-flex; align-items: center; padding: .15rem .5rem; border-radius: .375rem;
  background: var(--status-panel-muted-bg); border: 1px solid var(--status-panel-muted-border);
  font-size: .75rem; font-weight: 600; color: var(--status-text-muted);
}
${R} .status-service__description { font-size: .875rem; color: var(--status-text-muted); line-height: 1.55; }
${R} .status-service__facts {
  display: flex; flex-wrap: wrap; gap: 1.25rem; font-size: .8125rem; color: var(--status-text-muted);
}
${R} .status-service__facts b { color: var(--status-text-strong); font-variant-numeric: tabular-nums; }

/* ---- daily history ----
   Every day gets an equal fraction of the strip. There is deliberately no minimum bar width and
   no horizontal scrolling: all 90 days always compress into the card's actual inline size. */
${R} .status-history { display: grid; gap: .5rem; container-type: inline-size; min-inline-size: 0; inline-size: 100%; max-inline-size: 100%; overflow: hidden; }
${R} .status-history__strip {
  display: grid; grid-template-columns: repeat(90, minmax(0, 1fr)); align-items: stretch;
  gap: 3px; min-height: 2.65rem; padding: .55rem .75rem;
  border: 1px solid var(--status-panel-muted-border); border-radius: .75rem;
  background: var(--status-panel-muted-bg); box-shadow: inset 0 1px 2px rgba(15, 23, 42, .06);
  inline-size: 100%; max-inline-size: 100%; min-inline-size: 0; overflow: hidden;
}
${R} .status-history__item { position: relative; min-inline-size: 0; inline-size: 100%; overflow: visible; }
${R} .status-history__cell {
  display: block; inline-size: 100%; min-inline-size: 0; block-size: 1.55rem; padding: 0;
  border: 0; border-radius: 2px;
  cursor: pointer; background: var(--status-unknown-bg);
  transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
}
${R} .status-history__cell:hover, ${R} .status-history__cell[aria-expanded='true'] {
  transform: scaleY(1.22); filter: saturate(1.1);
  box-shadow: 0 0 0 1px var(--status-text-strong), 0 4px 10px rgba(15, 23, 42, .16); z-index: 2;
}
${R} .status-history__cell.status-operational { background: var(--status-operational); }
${R} .status-history__cell.status-degraded { background: var(--status-degraded); }
${R} .status-history__cell.status-maintenance { background: var(--status-maintenance); }
${R} .status-history__cell.status-partial-outage { background: var(--status-partial-outage); }
${R} .status-history__cell.status-major-outage { background: var(--status-major-outage); }
/* Never colour alone: unverified days are also hatched. */
${R} .status-history__cell.status-unknown {
  background: repeating-linear-gradient(
    45deg, var(--status-unknown-bg), var(--status-unknown-bg) 3px,
    color-mix(in srgb, var(--status-unknown) 35%, transparent) 3px,
    color-mix(in srgb, var(--status-unknown) 35%, transparent) 6px
  );
}
${R} .status-history__cell:focus-visible { outline: 3px solid var(--primary); outline-offset: 2px; }
${R} .status-history__scale {
  display: flex; justify-content: space-between; font-size: .75rem; color: var(--status-text-subtle);
}
@container (max-width: 64rem) {
  ${R} .status-history__strip { gap: 2px; padding-inline: .5rem; }
}
@container (max-width: 36rem) {
  ${R} .status-history__strip { gap: 1px; padding-inline: .25rem; }
  ${R} .status-history__cell { border-radius: 1px; }
}
@container (max-width: 22rem) {
  ${R} .status-history__strip { gap: .5px; padding-inline: 2px; }
}

/* ---- day inspector ---- */
${R} .status-history__tooltip {
  position: relative; z-index: 20; width: 100%;
  display: grid; gap: .9rem; padding: clamp(1rem, 2.5vw, 1.35rem); text-align: left;
  color: var(--status-text); background: var(--status-panel-bg);
  border: 1px solid var(--status-panel-border); border-radius: .9rem;
  box-shadow: 0 16px 36px rgba(15, 23, 42, .12);
  animation: status-inspector-in .18s ease-out;
}
${R} .status-history__tooltip-head {
  display: flex; align-items: center; justify-content: space-between; gap: .75rem;
}
${R} .status-history__tooltip-head > div { display: grid; gap: .15rem; }
${R} .status-history__tooltip-head strong { color: var(--status-text-strong); }
${R} .status-history__service-label { color: var(--status-text-muted); font-size: .75rem; }
${R} .status-history__close { width: 1.75rem; height: 1.75rem; border: 0; border-radius: 999px; background: var(--status-panel-muted-bg); color: var(--status-text-muted); cursor: pointer; font-size: 1.1rem; }
${R} .status-history__close:hover { color: var(--status-text-strong); background: var(--status-panel-muted-border); }
${R} .status-history__day-stats { display: flex; flex-wrap: wrap; gap: .65rem; }
${R} .status-history__day-stats span { padding: .55rem .7rem; border-radius: .55rem; background: var(--status-panel-muted-bg); color: var(--status-text-muted); font-size: .8125rem; }
${R} .status-history__day-stats b { color: var(--status-text-strong); font-variant-numeric: tabular-nums; }
${R} .status-history__timeline-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .4rem; font-size: .75rem; color: var(--status-text-muted); }
${R} .status-history__timeline-head strong { color: var(--status-text-strong); font-size: .8125rem; }
${R} .status-history__timeline { position: relative; height: 3.25rem; padding: .25rem; border: 1px solid var(--status-panel-muted-border); background: var(--status-panel-muted-bg); border-radius: .6rem; overflow: hidden; }
${R} .status-history__segments { display: flex; height: 100%; gap: 1px; overflow: hidden; border-radius: .35rem; }
${R} .status-history__segments > span { min-width: 1px; background: var(--status-operational); }
${R} .status-history__segments > span.status-degraded { background: var(--status-degraded); }
${R} .status-history__segments > span.status-maintenance { background: var(--status-maintenance); }
${R} .status-history__segments > span.status-partial-outage { background: var(--status-partial-outage); }
${R} .status-history__segments > span.status-major-outage { background: var(--status-major-outage); }
${R} .status-history__segments > span.status-unknown { background: var(--status-unknown); }
${R} .status-history__markers { position: absolute; inset: .25rem; pointer-events: none; }
${R} .status-history__markers i { position: absolute; top: -.15rem; bottom: -.15rem; width: 2px; background: var(--status-text-inverse); box-shadow: 0 0 0 1px rgba(15, 23, 42, .65); transform: translateX(-1px); }
${R} .status-history__axis {
  display: flex; justify-content: space-between; font-size: .6875rem;
  color: var(--status-text-subtle); font-variant-numeric: tabular-nums;
}
${R} .status-history__incident-times { display: flex; flex-wrap: wrap; gap: .45rem; }
${R} .status-history__incident-times span { display: inline-flex; align-items: center; gap: .35rem; padding: .35rem .55rem; border-radius: .45rem; background: var(--status-major-outage-bg); color: var(--status-text-muted); font-size: .75rem; }
${R} .status-history__incident-times b { color: var(--status-major-outage); font-variant-numeric: tabular-nums; }
${R} .status-legend { display: flex; flex-wrap: wrap; gap: .625rem; font-size: .6875rem; }
${R} .status-legend span { display: inline-flex; align-items: center; gap: .3rem; color: var(--status-text-muted); }
${R} .status-legend i { width: .625rem; height: .625rem; border-radius: 2px; background: currentColor; }

/* ---- uptime metrics ---- */
${R} .status-uptime-grid {
  display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); min-inline-size: 0;
}
${R} .status-uptime-card { position: relative; display: grid; gap: 1.15rem; overflow: hidden; transition: transform .2s ease, box-shadow .2s ease; }
${R} .status-uptime-card::before { content: ''; position: absolute; inset: 0 0 auto; height: 3px; background: linear-gradient(90deg, var(--status-operational), color-mix(in srgb, var(--status-operational) 35%, var(--primary))); }
${R} .status-uptime-card[data-tier='good']::before { background: linear-gradient(90deg, var(--status-degraded), var(--primary)); }
${R} .status-uptime-card[data-tier='poor']::before { background: linear-gradient(90deg, var(--status-major-outage), var(--status-degraded)); }
${R} .status-uptime-card:hover { transform: translateY(-3px); box-shadow: 0 18px 40px rgba(15, 23, 42, .11); }
${R} .status-uptime-card__head {
  display: flex; align-items: center; justify-content: space-between; gap: .75rem;
}
${R} .status-uptime-window { display: grid; gap: .5rem; padding-top: .15rem; }
${R} .status-uptime-window__row {
  display: flex; align-items: baseline; justify-content: space-between; gap: .5rem;
  font-size: .75rem; color: var(--status-text-subtle);
  font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
}
${R} .status-uptime-window__value {
  font-size: clamp(1.35rem, 3vw, 1.75rem); font-weight: 780; letter-spacing: -.025em; text-transform: none;
  color: var(--status-text-strong); font-variant-numeric: tabular-nums;
}
${R} .status-meter {
  height: .7rem; border-radius: 999px; overflow: hidden;
  background: var(--status-panel-muted-bg); border: 1px solid var(--status-panel-muted-border);
}
${R} .status-meter > span { display: block; height: 100%; background: linear-gradient(90deg, color-mix(in srgb, var(--status-operational) 72%, #34d399), var(--status-operational)); transition: width .7s ease; }
${R} .status-meter[data-tier='good'] > span { background: var(--status-degraded); }
${R} .status-meter[data-tier='poor'] > span { background: var(--status-major-outage); }
${R} .status-meter[data-tier='unknown'] > span { background: var(--status-unknown); }

/* ---- regions ---- */
${R} .status-region-grid {
  display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); min-inline-size: 0;
}
${R} .status-region { display: grid; gap: .5rem; align-content: start; }
${R} .status-region__head {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem;
}
${R} .status-region__head h3 { font-size: .9375rem; font-weight: 700; color: var(--status-text-strong); }
${R} .status-region__summary { font-size: .8125rem; color: var(--status-text-muted); }
${R} .status-region__detail {
  display: grid; gap: .2rem; margin-top: .25rem; font-size: .75rem; color: var(--status-text-muted);
}
${R} .status-region__detail div { display: flex; justify-content: space-between; gap: 1rem; }
${R} .status-disclosure > summary {
  cursor: pointer; font-size: .75rem; font-weight: 600; color: var(--primary); list-style: none;
}
${R} .status-disclosure > summary::-webkit-details-marker { display: none; }
${R} .status-disclosure > summary:focus-visible {
  outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent);
  border-radius: .25rem;
}

/* ---- local-time hint ---- */
${R} .status-hint {
  display: inline-flex; align-items: center; gap: .3rem; padding: 0; border: 0;
  background: none; color: var(--status-text-subtle); font-size: .75rem; cursor: help;
}
${R} .status-hint:focus-visible {
  outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent);
  border-radius: .25rem;
}

/* ---- incident / maintenance / notice feeds ---- */
${R} .status-feed { display: grid; gap: .75rem; }
${R} .status-feed-card {
  display: grid; gap: .65rem; padding: 1rem 1.15rem;
  border: 1px solid var(--status-panel-border); border-radius: .9rem;
  background: var(--status-panel-bg);
}
${R} .status-feed-card__head {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: .5rem;
}
${R} .status-feed-card__head h3 { font-size: 1rem; font-weight: 700; color: var(--status-text-strong); }
${R} .status-feed-card__meta {
  display: flex; flex-wrap: wrap; gap: .5rem .75rem; font-size: .8125rem; color: var(--status-text-muted);
}
${R} .status-feed-card__body { font-size: .9375rem; line-height: 1.55; color: var(--status-text); white-space: pre-wrap; word-break: break-word; }
${R} .status-feed-card__updates { display: grid; gap: .5rem; padding-top: .25rem; border-top: 1px solid var(--status-panel-muted-border); }
${R} .status-feed-card__updates li { display: grid; gap: .15rem; font-size: .8125rem; }
${R} .status-pager { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
${R} .status-pager button { cursor: pointer; }

/* ---- footer ---- */
${R} .status-subscribe {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(min(100%, 26rem), .8fr);
  align-items: center; gap: 1rem 2rem; padding: clamp(1.25rem, 3vw, 2rem);
  border: 1px solid var(--status-panel-border); border-radius: 1rem;
  background: var(--status-panel-bg); box-shadow: 0 6px 16px rgba(15, 23, 42, .05);
}
${R} .status-subscribe__copy { display: grid; gap: .35rem; min-inline-size: 0; }
${R} .status-subscribe__copy strong { color: var(--status-text-strong); font-size: clamp(1rem, 2vw, 1.2rem); }
${R} .status-subscribe__copy span { color: var(--status-text-muted); font-size: .875rem; }
${R} .status-subscribe__controls { display: flex; min-inline-size: 0; }
${R} .status-subscribe__input {
  min-inline-size: 0; inline-size: 100%; padding: .7rem .85rem;
  border: 1px solid var(--status-panel-border); border-radius: .65rem 0 0 .65rem;
  background: var(--status-panel-bg); color: var(--status-text);
}
${R} .status-subscribe__button {
  flex: 0 0 auto; padding: .7rem 1rem; border: 1px solid var(--primary); border-radius: 0 .65rem .65rem 0;
  background: var(--primary); color: var(--status-text-inverse); font-weight: 700; cursor: pointer;
}
${R} .status-subscribe__button:disabled { cursor: wait; opacity: .65; }
${R} .status-subscribe__input:focus-visible, ${R} .status-subscribe__button:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 30%, transparent); outline-offset: 2px; z-index: 1; }
${R} .status-subscribe__error { grid-column: 1 / -1; padding: .65rem .75rem; border: 1px solid #fca5a5; border-radius: .6rem; background: #fee2e2; color: #991b1b; font-size: .875rem; }
${R} .status-subscribe__success { display: grid; gap: .35rem; padding: 1.25rem; border: 1px solid #86efac; border-radius: .8rem; background: #dcfce7; text-align: center; color: #15803d; }
${R} .status-subscribe__success strong { color: #166534; font-size: 1.05rem; }

${R} .status-footer {
  margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--status-panel-border);
  display: grid; gap: .625rem; font-size: .8125rem; color: var(--status-text-muted);
}
${R} .status-footer__links { display: flex; flex-wrap: wrap; gap: .875rem; align-items: center; }
${R} .status-footer-link { color: var(--status-text-muted); text-decoration: none; }
${R} .status-footer-link:hover {
  color: var(--status-text-strong); text-decoration: underline;
  text-decoration-thickness: 2px; text-underline-offset: 3px;
}
${R} .status-footer-link:focus-visible {
  outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 30%, transparent);
  border-radius: .25rem;
}
${R} .status-footer__brand { display: inline-flex; align-items: center; gap: .4rem; }
${R} .status-footer__brand img { height: 1.125rem; width: auto; }

/* ---- responsive composition ---- */
@media (max-width: 48rem) {
  ${R} .status-panel { padding: clamp(.9rem, 4vw, 1.25rem); border-radius: .8rem; }
  ${R} .status-section { margin: clamp(2rem, 9vw, 3rem) 0; gap: 1rem; }
  ${R} .status-overview__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  ${R} .status-service { padding: clamp(.9rem, 4vw, 1.2rem); border-radius: .8rem; }
  ${R} .status-service__facts { gap: .55rem 1rem; }
  ${R} .status-history__tooltip-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  ${R} .status-history__tooltip-head .status-badge { justify-self: start; }
  ${R} .status-history__close { grid-column: 2; grid-row: 1; }
  ${R} .status-history__timeline-head span { display: none; }
  ${R} .status-region-grid, ${R} .status-uptime-grid { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 40rem) {
  ${R} .status-page-header { position: relative !important; top: auto !important; }
  ${R} .status-overview__stats { grid-template-columns: minmax(0, 1fr); }
  ${R} .status-service__head { display: grid; grid-template-columns: minmax(0, 1fr); }
  ${R} .status-service__head > .status-badge { justify-self: start; }
  ${R} .status-toolbar__row { align-items: stretch; }
  ${R} .status-toolbar__search { flex-basis: 100%; }
  ${R} .status-page-input, ${R} .status-page-select { inline-size: 100% !important; min-inline-size: 0 !important; flex: 1 1 100%; }
  ${R} .status-history__day-stats > span { flex: 1 1 9rem; }
  ${R} .status-history__axis { font-size: .625rem; }
  ${R} .status-subscribe { grid-template-columns: minmax(0, 1fr); }
  ${R} .status-subscribe__controls { display: grid; gap: .6rem; }
  ${R} .status-subscribe__input, ${R} .status-subscribe__button { border-radius: .65rem; }
}

@keyframes status-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}
@keyframes status-inspector-in { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
${R} .status-pulse { animation: status-pulse 2s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  ${R} .status-pulse, ${R} .status-history__tooltip { animation: none; }
  ${R} * { transition: none !important; }
}

/* ---- V3-native surface (progressive rollout) ---- */
/* Status accent token, set by any element carrying data-status. Drives borders and bars. */
${R} [data-status="operational"] { --v3-accent: var(--status-operational); }
${R} [data-status="degraded"] { --v3-accent: var(--status-degraded); }
${R} [data-status="maintenance"] { --v3-accent: var(--status-maintenance); }
${R} [data-status="partial-outage"] { --v3-accent: var(--status-partial-outage); }
${R} [data-status="major-outage"] { --v3-accent: var(--status-major-outage); }
${R} [data-status="unknown"] { --v3-accent: var(--status-unknown); }

${R} .status-v3 { display: grid; gap: clamp(1.75rem, 4vw, 3rem); }
${R} .status-v3 h2 { font-size: clamp(1.15rem, 2.2vw, 1.4rem); font-weight: 750; letter-spacing: -.015em; color: var(--status-text-strong); margin: 0 0 1rem; }

/* Hero */
${R} .status-v3-hero { position: relative; overflow: hidden; display: grid; gap: clamp(1rem, 3vw, 1.75rem); grid-template-columns: minmax(0, 1fr); align-items: center; }
${R} .status-v3-hero::before { content: ''; position: absolute; inset: 0 0 auto 0; block-size: 4px; background: var(--v3-accent, var(--status-unknown)); }
${R} .status-v3-hero__banner { display: grid; gap: .55rem; justify-items: start; }
${R} .status-v3-hero__mark { display: inline-flex; align-items: center; gap: .6rem; }
${R} .status-v3-hero__banner h1 { font-size: clamp(1.6rem, 4.5vw, 2.4rem); font-weight: 820; line-height: 1.1; letter-spacing: -.025em; color: var(--status-text-strong); }
${R} .status-v3-hero__note, ${R} .status-v3-hero__confidence { margin: 0; color: var(--status-text-muted); font-size: .9rem; }
${R} .status-v3-hero__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: clamp(.75rem, 2vw, 1.25rem); margin: 0; }
${R} .status-v3-hero__stats .status-stat { padding: .85rem 1rem; border: 1px solid var(--status-panel-border); border-radius: .75rem; background: var(--status-panel-muted-bg); }

/* Status dot */
${R} .status-v3-dot { inline-size: .7rem; block-size: .7rem; border-radius: 999px; background: currentColor; flex: none; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 18%, transparent); }
${R} .status-v3-dot--lg { inline-size: 1rem; block-size: 1rem; }

/* Section cards */
${R} .status-v3-services__list, ${R} .status-v3-maintenance__list, ${R} .status-v3-incidents__list, ${R} .status-v3-announcements__list, ${R} .status-v3-changelog__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .9rem; }
${R} .status-v3-services__list { grid-template-columns: minmax(0, 1fr); }
${R} .status-v3-service { grid-template-columns: minmax(0, 1fr); min-inline-size: 0; }
${R} .status-v3-regions__list { list-style: none; margin: 0; padding: 0; display: grid; gap: .9rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); }
${R} .status-v3-services__bar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .65rem; margin-block-end: 1rem; }
${R} .status-v3-search input {
  inline-size: 100%; padding: .55rem .85rem; border: 1px solid var(--status-panel-border); border-radius: .65rem;
  background: var(--status-panel-bg); color: var(--status-text); font: inherit;
}
${R} .status-v3-search input:focus-visible { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 25%, transparent); }
${R} .status-v3-filters { display: flex; flex-wrap: wrap; gap: .4rem; }
${R} .status-v3-filters .status-v3-chip { cursor: pointer; background: var(--status-panel-bg); gap: .35rem; }
${R} .status-v3-filters .status-v3-chip[aria-pressed="true"] { color: var(--primary); border-color: color-mix(in srgb, var(--primary) 45%, var(--status-panel-border)); background: color-mix(in srgb, var(--primary) 10%, var(--status-panel-bg)); }
${R} .status-v3-group {
  display: grid;
  gap: 0.6rem;
  margin-block-end: 1.5rem;
}

${R} .status-v3-group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-block-end: 0.5rem;
  border-block-end: 1px solid var(--status-panel-border);
}

${R} .status-v3-group__title-wrap {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

${R} .status-v3-group__title {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-size: 0.9rem;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--status-text-strong);
  overflow-wrap: anywhere;
}

${R} .status-v3-group__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}

${R} .status-v3-group__subtitle {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--status-text-muted);
}

${R} .status-v3-group__tally {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

${R} .status-v3-group__tally-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
}

${R} .status-v3-group__dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  display: inline-block;
}

${R} .status-v3-group__tally-pill--healthy {
  color: #047857;
  background: #ecfdf5;
  border: 1px solid rgba(4, 120, 87, 0.18);
}
${R} .status-v3-group__tally-pill--healthy .status-v3-group__dot {
  background-color: #10b981;
}

${R} .status-v3-group__tally-pill--impacted {
  color: #ef4444;
  background: #fef2f2;
  border: 1px solid rgba(239, 68, 68, 0.2);
}
${R} .status-v3-group__tally-pill--impacted .status-v3-group__dot {
  background-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

${R} .status-v3-service, ${R} .status-v3-region, ${R} .status-v3-maintenance__item, ${R} .status-v3-incident, ${R} .status-v3-announcement, ${R} .status-v3-changelog__item {
  border: 1px solid var(--status-panel-border); border-inline-start: 3px solid var(--v3-accent, var(--status-panel-border));
  border-radius: .9rem; background: var(--status-panel-bg); padding: clamp(.9rem, 2.5vw, 1.2rem) clamp(1rem, 3vw, 1.35rem);
  display: grid; gap: .6rem; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); transition: box-shadow .18s ease, transform .18s ease;
}
${R} .status-v3-service:hover, ${R} .status-v3-region:hover, ${R} .status-v3-incident:hover { box-shadow: 0 8px 24px rgba(15, 23, 42, .08); transform: translateY(-1px); }
${R} .status-v3-service__head, ${R} .status-v3-region__head, ${R} .status-v3-maintenance__head, ${R} .status-v3-incident__head { display: flex; justify-content: space-between; align-items: center; gap: .75rem; flex-wrap: wrap; }
${R} .status-v3-service__lead { display: inline-flex; align-items: center; gap: .55rem; min-inline-size: 0; }
${R} .status-v3-service__name, ${R} .status-v3-region__name, ${R} .status-v3-maintenance__title, ${R} .status-v3-incident__title, ${R} .status-v3-announcement__title, ${R} .status-v3-changelog__title { font-weight: 700; color: var(--status-text-strong); overflow-wrap: anywhere; }
${R} .status-v3-service__desc, ${R} .status-v3-maintenance__desc, ${R} .status-v3-incident__desc, ${R} .status-v3-announcement__message, ${R} .status-v3-changelog__message { margin: 0; color: var(--status-text-muted); font-size: .9rem; line-height: 1.55; }
${R} .status-v3-service__meta, ${R} .status-v3-maintenance__meta { display: flex; flex-wrap: wrap; gap: .45rem .6rem; font-size: .8125rem; color: var(--status-text-muted); align-items: center; }

/* Uptime meter */
${R} .status-v3-service__uptime { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
${R} .status-v3-meter { flex: 1 1 8rem; min-inline-size: 6rem; block-size: .5rem; border-radius: 999px; background: var(--status-panel-muted-bg); overflow: hidden; }
${R} .status-v3-meter > span { display: block; block-size: 100%; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--status-operational) 70%, #34d399), var(--status-operational)); }
${R} .status-v3-service__uptime-value { font-weight: 750; color: var(--status-text-strong); font-variant-numeric: tabular-nums; font-size: .875rem; }
${R} .status-v3-service__uptime-label { font-weight: 500; color: var(--status-text-muted); font-size: .8125rem; }

/* Chips + grades */
${R} .status-v3-chip { display: inline-flex; align-items: center; padding: .1rem .45rem; border-radius: 4px; border: 1px solid var(--status-panel-border); background: var(--status-panel-muted-bg); font-size: .7rem; font-weight: 600; color: var(--status-text-muted); line-height: 1.3; white-space: nowrap; }
${R} .status-v3-chip--muted { font-weight: 500; color: var(--status-text-subtle); }
${R} .status-v3-grade { display: inline-flex; align-items: center; padding: .18rem .55rem; border-radius: 999px; font-weight: 700; font-size: .75rem; }
${R} .status-v3-grade--excellent { color: var(--status-operational); background: var(--status-operational-bg); }
${R} .status-v3-grade--good { color: var(--status-degraded); background: var(--status-degraded-bg); }
${R} .status-v3-grade--below_target { color: var(--status-major-outage); background: var(--status-major-outage-bg); }

/* 90-day history sparkline: fills the row on every width */
${R} svg.status-v3-history { display: block; inline-size: 100%; block-size: 2.5rem; min-inline-size: 0; }
${R} svg.status-v3-history .status-operational, ${R} .status-v3-hours__slice.status-operational { color: var(--status-operational); }
${R} svg.status-v3-history .status-degraded, ${R} .status-v3-hours__slice.status-degraded { color: var(--status-degraded); }
${R} svg.status-v3-history .status-maintenance, ${R} .status-v3-hours__slice.status-maintenance { color: var(--status-maintenance); }
${R} svg.status-v3-history .status-partial-outage, ${R} .status-v3-hours__slice.status-partial-outage { color: var(--status-partial-outage); }
${R} svg.status-v3-history .status-major-outage, ${R} .status-v3-hours__slice.status-major-outage { color: var(--status-major-outage); }
${R} svg.status-v3-history .status-unknown, ${R} .status-v3-hours__slice.status-unknown { color: var(--status-unknown); }
${R} .status-v3-history__day {
  cursor: pointer;
  transition: opacity .15s ease, transform .15s ease, stroke-width .15s ease, filter .15s ease;
  transform-box: fill-box;
  transform-origin: center bottom;
}
${R} svg.status-v3-history:hover .status-v3-history__day { opacity: .6; }
${R} svg.status-v3-history .status-v3-history__day:hover,
${R} svg.status-v3-history .status-v3-history__day[aria-pressed="true"] {
  opacity: 1;
  transform: scaleY(1.25);
  stroke: var(--status-text-strong);
  stroke-width: .14;
}
${R} svg.status-v3-history .status-v3-history__day:hover:not([aria-pressed="true"]) {
  filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 65%, transparent));
}
${R} .status-v3-history__day:focus-visible { outline: none; stroke: var(--primary); stroke-width: .2; }

/* Incident timeline */
${R} .status-v3-incident__updates { list-style: none; margin: .35rem 0 0; padding: 0 0 0 1rem; display: grid; gap: .5rem; border-inline-start: 2px solid var(--status-panel-border); }
${R} .status-v3-update { position: relative; display: grid; gap: .1rem; font-size: .85rem; }
${R} .status-v3-update::before { content: ''; position: absolute; inset-inline-start: -1.35rem; inset-block-start: .35rem; inline-size: .5rem; block-size: .5rem; border-radius: 999px; background: var(--primary); box-shadow: 0 0 0 3px var(--status-panel-bg); }
${R} .status-v3-update__type { font-weight: 750; letter-spacing: .04em; font-size: .68rem; text-transform: uppercase; color: var(--status-text-subtle); }
${R} .status-v3-update__message { color: var(--status-text); overflow-wrap: anywhere; }
${R} .status-v3-incident__pir { display: inline-flex; align-items: center; gap: .3rem; margin-block-start: .35rem; color: var(--primary); font-weight: 650; text-decoration: none; font-size: .875rem; }
${R} .status-v3-incident__pir:hover { text-decoration: underline; text-underline-offset: 3px; }

/* Maintenance state accent */
${R} .status-v3-maintenance--scheduled { --v3-accent: var(--status-maintenance); }
${R} .status-v3-maintenance--in_progress { --v3-accent: var(--status-degraded); }
${R} .status-v3-maintenance--completed { --v3-accent: var(--status-operational); }
${R} .status-v3-maintenance__state { padding: .18rem .55rem; border-radius: 999px; font-size: .7rem; font-weight: 750; text-transform: uppercase; letter-spacing: .05em; color: var(--v3-accent, var(--status-text-muted)); background: color-mix(in srgb, var(--v3-accent, var(--status-unknown)) 12%, transparent); }
${R} .status-v3-maintenance__affected { margin: 0; font-size: .8125rem; color: var(--status-text-muted); }

/* Announcements + changelog */
${R} .status-v3-announcement--warning { --v3-accent: var(--status-degraded); }
${R} .status-v3-announcement--incident { --v3-accent: var(--status-major-outage); }
${R} .status-v3-announcement--maintenance { --v3-accent: var(--status-maintenance); }
${R} .status-v3-announcement--info { --v3-accent: var(--primary); }
${R} .status-v3-changelog { margin-block-start: 1.25rem; }
${R} .status-v3-changelog h3 { font-size: .8125rem; font-weight: 750; text-transform: uppercase; letter-spacing: .06em; color: var(--status-text-subtle); margin: 0 0 .75rem; }
${R} .status-v3-badge--sm { font-size: .75rem; }

/* Responsive: phones */
@media (max-width: 40rem) {
  ${R} .status-v3 { gap: 1.75rem; }
  ${R} .status-v3-hero__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  ${R} .status-v3-service__head, ${R} .status-v3-incident__head { align-items: flex-start; }
  ${R} .status-v3-history__day { block-size: 1.6rem; }
}
/* Responsive: tablets keep a single readable service column */
@media (min-width: 40.0625rem) and (max-width: 64rem) {
  ${R} .status-v3-services__list { grid-template-columns: minmax(0, 1fr); }
}
/* Responsive: large monitors get more breathing room and denser stats */
@media (min-width: 90rem) {
  ${R} .status-v3 { gap: 3.25rem; }
  ${R} .status-v3-hero { grid-template-columns: minmax(0, 1.4fr) minmax(18rem, 1fr); align-items: center; }
  ${R} .status-v3-hero__stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

/* ---- V3 premium polish ---- */
/* Section heading with a gradient accent bar */
${R} .status-v3 > section > h2 { position: relative; padding-inline-start: .9rem; display: flex; align-items: center; }
${R} .status-v3 > section > h2::before { content: ''; position: absolute; inset-block: .12em; inset-inline-start: 0; inline-size: .28rem; border-radius: 999px; background: linear-gradient(var(--primary), color-mix(in srgb, var(--primary) 35%, transparent)); }

/* Hero: layered gradient glow + soft glass, status-tinted */
${R} .status-v3-hero {
  background:
    radial-gradient(135% 150% at 100% 0%, color-mix(in srgb, var(--v3-accent, var(--primary)) 8%, transparent), transparent 62%),
    var(--status-panel-bg);
  box-shadow: 0 16px 38px -30px color-mix(in srgb, var(--v3-accent, var(--primary)) 45%, transparent);
}
${R} .status-v3-hero h1 { text-wrap: balance; }
${R} .status-v3-hero .status-badge { box-shadow: 0 8px 20px -10px currentColor; }

/* Stat cards: bold tabular numerals over a soft gradient */
${R} .status-v3-hero__stats .status-stat { background: linear-gradient(180deg, color-mix(in srgb, var(--status-panel-bg) 90%, var(--primary) 10%), var(--status-panel-muted-bg)); }
${R} .status-v3-hero__stats .status-stat__value { font-size: clamp(1.6rem, 4vw, 2.15rem); font-weight: 820; letter-spacing: -.03em; font-variant-numeric: tabular-nums; color: var(--status-text-strong); }

/* Cards: subtle vertical gradient + accent glow on hover */
${R} .status-v3-service, ${R} .status-v3-region, ${R} .status-v3-incident, ${R} .status-v3-maintenance__item, ${R} .status-v3-announcement, ${R} .status-v3-changelog__item {
  background: var(--status-panel-bg);
}
${R} .status-v3-service:hover, ${R} .status-v3-region:hover, ${R} .status-v3-incident:hover {
  box-shadow: 0 12px 30px -22px color-mix(in srgb, var(--v3-accent, var(--primary)) 55%, transparent);
  border-color: color-mix(in srgb, var(--v3-accent, var(--primary)) 35%, var(--status-panel-border));
}

/* Uptime meter with a glossy shine */
${R} .status-v3-meter { box-shadow: inset 0 1px 2px rgba(15, 23, 42, .12); }
${R} .status-v3-meter > span { position: relative; box-shadow: 0 0 12px -2px color-mix(in srgb, var(--status-operational) 60%, transparent); }
${R} .status-v3-meter > span::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(180deg, rgba(255, 255, 255, .45), transparent 55%); }

/* Sparkline: dim siblings, spotlight the hovered day */
/* Sparkline hover handled in the SVG history rules */

/* Incident timeline markers glow in the accent colour */
${R} .status-v3-incident__updates { border-inline-start-color: color-mix(in srgb, var(--v3-accent, var(--primary)) 35%, var(--status-panel-border)); }
${R} .status-v3-update::before { background: var(--v3-accent, var(--primary)); box-shadow: 0 0 0 3px var(--status-panel-bg), 0 0 10px color-mix(in srgb, var(--v3-accent, var(--primary)) 60%, transparent); }

/* A calm pulse on a fully-operational hero */
${R} .status-v3-hero[data-status="operational"] .status-v3-hero__live { animation: status-pulse 2.6s ease-in-out infinite; }

/* Staggered entrance for each section */
@keyframes status-v3-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes status-v3-inspector-in { from { opacity: 0; transform: translateY(6px) scale(0.98); } to { opacity: 1; transform: none; } }
${R} .status-v3 > * { animation: status-v3-in .5s cubic-bezier(.2, .7, .2, 1) both; }
${R} .status-v3 > *:nth-child(2) { animation-delay: .06s; }
${R} .status-v3 > *:nth-child(3) { animation-delay: .12s; }
${R} .status-v3 > *:nth-child(4) { animation-delay: .18s; }
${R} .status-v3 > *:nth-child(5) { animation-delay: .24s; }
${R} .status-v3 > *:nth-child(6) { animation-delay: .3s; }

/* ---- Incidents — best-in-class, settings-compatible (no new controls) ---- */
${R} .status-v3-incidents-inline { display: flex; flex-direction: column; gap: 0.5rem; }
${R} .status-v3-incidents-inline__head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem 1rem; flex-wrap: wrap;
  padding-block-end: 0.55rem; border-block-end: 1px solid var(--status-panel-border);
}
${R} .status-v3-incidents-inline__title-wrap { display: flex; align-items: baseline; gap: 0.55rem; flex-wrap: wrap; }
${R} .status-v3-incidents-inline__title {
  margin: 0; font-family: 'Space Grotesk', Inter, sans-serif; font-size: 1.05rem; font-weight: 700; letter-spacing: -0.015em; color: var(--status-text-strong);
}
${R} .status-v3-incidents-inline__subtitle { font-size: 0.72rem; font-weight: 500; color: var(--status-text-muted); letter-spacing: 0.01em; }
${R} .status-v3-incidents-inline__tally { display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
${R} .status-v3-incidents-inline__tally-pill {
  display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.7rem; font-weight: 600;
  padding: 0.15rem 0.5rem; border-radius: 4px; white-space: nowrap; letter-spacing: 0.01em;
}
${R} .status-v3-incidents-inline__dot { width: 5px; height: 5px; border-radius: 9999px; display: inline-block; }
${R} .status-v3-incidents-inline__tally-pill--active { color: #b45309; background: #fef3c7; border: 1px solid rgba(180,83,9,0.2); }
${R} .status-v3-incidents-inline__tally-pill--active .status-v3-incidents-inline__dot { background: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,0.25); }
${R} .status-v3-incidents-inline__tally-pill--resolved { color: #475569; background: #f1f5f9; border: 1px solid rgba(71,85,105,0.18); }
${R} .status-v3-incidents-inline__tally-pill--resolved .status-v3-incidents-inline__dot { background: #94a3b8; }
${R} .status-v3-incidents-inline__list { display: grid; gap: 0.5rem; }
${R} .status-v3-incidents-inline__empty { margin: 0; padding: 0.75rem 0; color: var(--status-text-muted); font-size: 0.84rem; display: grid; gap: 0.5rem; justify-items: start; }
${R} .status-v3-incidents-inline__empty-title { margin: 0; color: var(--status-text-muted); font-size: 0.84rem; }
${R} .status-v3-filter { min-inline-size: 0; max-inline-size: 100%; display: inline-flex; }
${R} .status-v3-filter select {
  max-inline-size: 100%; padding: .4rem 1.9rem .4rem .7rem; border: 1px solid var(--status-panel-border); border-radius: 4px;
  background-color: var(--status-panel-bg); color: var(--status-text); font-size: .76rem; font-weight: 600; cursor: pointer; appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: right 1.0rem center, right .7rem center; background-size: .32rem .32rem, .32rem .32rem; background-repeat: no-repeat;
}
${R} .status-v3-filter select:focus-visible { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 25%, transparent); }

/* Pill card — same 4px / 1px / 3px system as maintenance/announcements */
${R} details.status-v3-incident-pill {
  display: block; padding: 0; overflow: hidden; border-radius: 4px;
  background: var(--status-panel-bg, #fff); border: 1px solid var(--status-panel-border, #e2e8f0);
  box-shadow: 0 1px 2px rgba(15,23,42,0.03); transition: border-color .15s ease, box-shadow .15s ease;
  content-visibility: auto; contain-intrinsic-size: auto 160px;
}
${R} details.status-v3-incident-pill[data-active="true"] { border-inline-start: 3px solid var(--v3-accent, var(--status-major-outage)); }
${R} details.status-v3-incident-pill[data-active="false"] { border-inline-start: 3px solid #cbd5e1; }
${R} details.status-v3-incident-pill:hover { border-color: color-mix(in srgb, var(--v3-accent, var(--primary)) 25%, var(--status-panel-border)); box-shadow: 0 2px 5px rgba(15,23,42,0.05); }
${R} details.status-v3-incident-pill[data-active="false"]:hover { border-inline-start-color: #94a3b8; }

/* Legacy alias — keep old incidents rendering correctly if any cached snapshot uses it */
${R} details.status-v3-incident { display: block; padding: 0; overflow: hidden; border-radius: 4px; background: var(--status-panel-bg, #fff); border: 1px solid var(--status-panel-border); }
${R} .status-v3-incident__summary { display: flex; align-items: center; justify-content: space-between; gap: .75rem 1rem; padding: clamp(.8rem, 2.5vw, 1.05rem) clamp(1rem, 3vw, 1.3rem); cursor: pointer; list-style: none; flex-wrap: wrap; }
${R} .status-v3-incident__summary::-webkit-details-marker { display: none; }
${R} .status-v3-incident__body { display: grid; gap: .6rem; padding: 0 clamp(1rem, 3vw, 1.3rem) clamp(1rem, 3vw, 1.3rem); border-block-start: 1px solid var(--status-panel-border); padding-block-start: .85rem; }

${R} .status-v3-incident-pill__summary {
  display: flex; align-items: center; justify-content: space-between; gap: 0.65rem 1rem; flex-wrap: wrap;
  padding: 0.55rem 0.75rem; cursor: pointer; list-style: none;
}
${R} .status-v3-incident-pill__summary::-webkit-details-marker { display: none; }
${R} .status-v3-incident-pill__summary:hover { background: color-mix(in srgb, var(--v3-accent, var(--primary)) 4%, transparent); }
${R} .status-v3-incident-pill__summary-main { display: inline-flex; align-items: center; gap: 0.45rem; min-inline-size: 0; flex: 1 1 16rem; flex-wrap: wrap; }
${R} .status-v3-incident-pill__summary-meta { display: inline-flex; align-items: center; gap: 0.4rem 0.5rem; flex-wrap: wrap; color: var(--status-text-muted); font-size: 0.76rem; margin-inline-start: auto; flex-shrink: 0; }
${R} .status-v3-incident-pill__icon { color: var(--status-text-subtle); flex-shrink: 0; }
${R} .status-v3-incident-pill__live { inline-size: 6px; block-size: 6px; border-radius: 999px; background: var(--v3-accent, var(--status-major-outage)); flex: none; box-shadow: 0 0 0 4px color-mix(in srgb, var(--v3-accent, var(--status-major-outage)) 16%, transparent); }
${R} details.status-v3-incident-pill[data-active="true"] .status-v3-incident-pill__live { animation: status-pulse 2s ease-in-out infinite; }
${R} .status-v3-incident-pill__title { font-family: 'Space Grotesk', Inter, sans-serif; font-weight: 650; font-size: 0.85rem; color: var(--status-text-strong); letter-spacing: -0.01em; overflow-wrap: anywhere; }
${R} .status-v3-incident-pill__divider { width: 1px; height: 11px; background: var(--status-panel-border); display: inline-block; flex-shrink: 0; }
${R} .status-v3-incident-pill__time { font-size: 0.75rem; font-weight: 500; color: var(--status-text-subtle); }
${R} .status-v3-incident-pill__duration { font-size: 0.7rem; font-weight: 600; color: var(--status-text-muted); padding: 0.1rem 0.4rem; border-radius: 999px; background: var(--status-panel-muted-bg); border: 1px solid var(--status-panel-border); white-space: nowrap; }
@media (max-width: 640px) { ${R} .status-v3-incident-pill__divider { display: none; } }
${R} .status-v3-incident-pill__chevron { inline-size: .5rem; block-size: .5rem; border-inline-end: 2px solid currentColor; border-block-end: 2px solid currentColor; transform: rotate(45deg); transition: transform .18s ease; opacity: .55; flex: none; }
${R} details.status-v3-incident-pill[open] .status-v3-incident-pill__chevron { transform: rotate(-135deg); }
${R} .status-v3-incident-pill__body { display: grid; gap: 0.45rem; padding: 0 0.75rem 0.65rem; border-block-start: 1px solid var(--status-panel-border); padding-block-start: 0.55rem; }
${R} .status-v3-incident-pill__subtle { font-size: 0.75rem; color: var(--status-text-subtle); line-height: 1.4; }
${R} .status-v3-incident-pill__desc { margin: 0; font-size: 0.8rem; line-height: 1.5; color: var(--status-text-muted); overflow-wrap: anywhere; }
${R} .status-v3-incident-pill__desc--clamped { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
${R} .status-v3-incident-pill__updates { list-style: none; margin: 0.25rem 0 0; padding: 0 0 0 0.9rem; display: grid; gap: 0.45rem; border-inline-start: 2px solid color-mix(in srgb, var(--v3-accent, var(--primary)) 30%, var(--status-panel-border)); }
${R} .status-v3-incident-pill__updates .status-v3-update { position: relative; display: grid; gap: 0.1rem; font-size: 0.84rem; }
${R} .status-v3-incident-pill__updates .status-v3-update::before { content: ''; position: absolute; inset-inline-start: -1.3rem; inset-block-start: 0.38rem; inline-size: 0.5rem; block-size: 0.5rem; border-radius: 999px; background: var(--v3-accent, var(--primary)); box-shadow: 0 0 0 3px var(--status-panel-bg); }
${R} .status-v3-update__time { font-size: 0.72rem; color: var(--status-text-subtle); }
${R} .status-v3-incident-pill__pir { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--primary); font-weight: 650; text-decoration: none; font-size: 0.82rem; margin-block-start: 0.15rem; }
${R} .status-v3-incident-pill__pir:hover { text-decoration: underline; text-underline-offset: 3px; }
${R} .status-v3-incident-pill__pir--muted { color: var(--status-text-muted); text-decoration: none; }
${R} .status-v3-incident-pill__affects { display: flex; align-items: center; gap: 0.35rem 0.45rem; flex-wrap: wrap; margin-block-start: 0.15rem; }
${R} .status-v3-incident-pill__affected-label { font-size: 0.72rem; font-weight: 600; color: var(--status-text-subtle); }
${R} .status-v3-incident-pill--redacted { border-inline-start-color: #cbd5e1 !important; opacity: 0.96; }
${R} .status-v3-incident-pill__redacted { margin: 0; font-size: 0.78rem; line-height: 1.45; color: var(--status-text-muted); background: color-mix(in srgb, var(--status-panel-muted-bg, #f1f5f9) 75%, transparent); border: 1px dashed var(--status-panel-border, #e2e8f0); border-radius: 4px; padding: 0.4rem 0.55rem; font-style: italic; }
${R} .status-v3-incident-pill__redacted-badge { font-size: 0.68rem; font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; color: #475569; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 0.08rem 0.36rem; border-radius: 999px; white-space: nowrap; }
${R} .status-v3-showmore { margin-block-start: 0.6rem; padding: 0.45rem 0.9rem; border: 1px solid var(--status-panel-border); border-radius: 4px; background: var(--status-panel-muted-bg); color: var(--status-text); font-weight: 650; font-size: 0.78rem; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
${R} .status-v3-showmore:hover { border-color: color-mix(in srgb, var(--primary) 45%, var(--status-panel-border)); background: color-mix(in srgb, var(--primary) 8%, var(--status-panel-muted-bg)); }
@media (prefers-reduced-motion: reduce) { ${R} details.status-v3-incident-pill[data-active="true"] .status-v3-incident-pill__live { animation: none; } }

/* Uptime / 90-day history card + day inspector */
${R} .status-v3-uptime { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: .35rem; margin-block-start: .25rem; min-inline-size: 0; }
${R} .status-v3-uptime, ${R} .status-v3-inspector, ${R} .status-v3-hours, ${R} .status-v3 > section { min-inline-size: 0; max-inline-size: 100%; }
${R} .status-v3-uptime__head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; flex-wrap: wrap; }
${R} .status-v3-uptime__value { font-weight: 750; color: var(--status-text-strong); font-variant-numeric: tabular-nums; font-size: .82rem; }
${R} .status-v3-uptime__unit { font-weight: 500; color: var(--status-text-muted); font-size: .74rem; }
${R} .status-v3-history__axis { display: flex; justify-content: space-between; gap: .5rem; font-size: .66rem; color: var(--status-text-subtle); }
${R} .status-v3-inspector {
  margin-block-start: .4rem;
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 0.45rem;
  padding: 0.65rem 0.9rem;
  border-radius: 4px;
  background: var(--status-panel-bg, #ffffff);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  animation: status-v3-inspector-in .2s cubic-bezier(.2, .7, .2, 1) both;
}
${R} .status-v3-inspector:hover {
  border-color: color-mix(in srgb, var(--primary) 25%, var(--status-panel-border));
  box-shadow: 0 2px 5px rgba(15, 23, 42, 0.05);
}
${R} .status-v3-inspector__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  flex-wrap: wrap;
}
${R} .status-v3-inspector__lead {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem 0.65rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}
${R} .status-v3-inspector__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}
${R} .status-v3-inspector__date {
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-weight: 650;
  font-size: 0.875rem;
  color: var(--status-text-strong);
  letter-spacing: -0.01em;
}
${R} .status-v3-inspector__divider {
  width: 1px;
  height: 11px;
  background: var(--status-panel-border);
  display: inline-block;
  flex-shrink: 0;
}
${R} .status-v3-inspector__close {
  border: 0;
  background: var(--status-panel-muted-bg);
  color: var(--status-text-muted);
  inline-size: 1.7rem;
  block-size: 1.7rem;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease, background-color 0.15s ease;
  flex-shrink: 0;
}
${R} .status-v3-inspector__close:hover {
  color: var(--status-text-strong);
  background: var(--status-panel-muted-border);
}
${R} .status-v3-inspector__relative {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--status-text-subtle);
}
${R} .status-v3-inspector__actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
${R} .status-v3-inspector__nav {
  border: 0;
  background: var(--status-panel-muted-bg);
  color: var(--status-text-muted);
  inline-size: 1.7rem;
  block-size: 1.7rem;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease, background-color 0.15s ease;
  flex-shrink: 0;
}
${R} .status-v3-inspector__nav:hover:not(:disabled) {
  color: var(--status-text-strong);
  background: var(--status-panel-muted-border);
}
${R} .status-v3-inspector__nav:disabled {
  opacity: 0.3;
  cursor: default;
}
${R} .status-v3-inspector__breakdown {
  display: flex;
  block-size: 4px;
  border-radius: 999px;
  overflow: hidden;
  gap: 1px;
  background: var(--status-panel-muted-bg);
}
${R} .status-v3-inspector__breakdown-seg {
  display: block;
  block-size: 100%;
  background: currentColor;
  min-inline-size: 2px;
  border-radius: 1px;
}
${R} .status-v3-inspector__chips {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem 0.45rem;
  flex-wrap: wrap;
}
${R} .status-v3-inspector__chips .status-v3-chip {
  font-size: 0.72rem;
  padding: 0.12rem 0.45rem;
}
${R} .status-v3-inspector__chip-label {
  font-weight: 500;
  color: var(--status-text-subtle);
  margin-inline-end: 0.2rem;
}
${R} .status-v3-inspector__timeline-wrap {
  display: grid;
  gap: 0.3rem;
  margin-block-start: 0.1rem;
}
${R} .status-v3-hours { position: relative; block-size: 2.5rem; border-radius: .6rem; overflow: hidden; background: var(--status-operational); border: 1px solid var(--status-panel-border); }
${R} .status-v3-hours__slice { position: absolute; inset-block: 0; background: currentColor; }
${R} .status-v3-hours__axis { display: flex; justify-content: space-between; font-size: .66rem; color: var(--status-text-subtle); font-variant-numeric: tabular-nums; }

/* Inline 30/90-day uptime inside each service card — compact, V3 4px, settings-controlled */
${R} .status-v3-uptime-metrics-inline {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .4rem .9rem;
  margin-block-start: .15rem;
  padding-block-start: .45rem;
  border-block-start: 1px solid color-mix(in srgb, var(--status-panel-border) 70%, transparent);
}
${R} .status-v3-uptime-cell { display: grid; gap: .22rem; min-inline-size: 0; }
${R} .status-v3-uptime-cell__head {
  display: flex; align-items: baseline; justify-content: space-between; gap: .4rem;
  font-size: .62rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--status-text-subtle); line-height: 1;
}
${R} .status-v3-uptime-cell__value {
  font-size: .78rem; font-weight: 750; letter-spacing: -.015em; text-transform: none;
  color: var(--status-text-strong); font-variant-numeric: tabular-nums; line-height: 1;
}
${R} .status-v3-uptime-cell__meter {
  block-size: 3px; border-radius: 999px; overflow: hidden;
  background: var(--status-panel-muted-bg); border: 0;
}
${R} .status-v3-uptime-cell__meter > span { display: block; block-size: 100%; border-radius: inherit; transition: inline-size .5s ease; }
${R} .status-v3-uptime-cell__meter[data-tier='excellent'] > span { background: var(--status-operational); }
${R} .status-v3-uptime-cell__meter[data-tier='good'] > span { background: var(--status-degraded); }
${R} .status-v3-uptime-cell__meter[data-tier='poor'] > span { background: var(--status-major-outage); }
${R} .status-v3-uptime-cell__meter[data-tier='unknown'] > span { background: var(--status-unknown); }
${R} .status-v3-uptime-cell__meta { font-size: .66rem; color: var(--status-text-muted); line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${R} .status-v3-uptime-cell__partial { color: var(--status-text-subtle); }
@media (max-width: 40rem) {
  ${R} .status-v3-uptime-metrics-inline { grid-template-columns: minmax(0, 1fr); gap: .35rem; }
}

@media (prefers-reduced-motion: reduce) {
  ${R} .status-v3 > *, ${R} .status-v3-hero[data-status="operational"] .status-v3-hero__live, ${R} .status-v3-inspector, ${R} .status-v3-inspector__breakdown-seg { animation: none !important; }
  ${R} .status-v3-history__day { transition: none !important; }
}
@media (prefers-reduced-motion: reduce) {
  ${R} .status-v3-maintenance-pill, ${R} .status-v3-announcement-pill, ${R} .status-v3-changelog-pill { transition: none !important; }
}

/* ---- modern chrome (status.x.ai-inspired top/bottom bars) ---- */
${R} .status-topbar {
  position: sticky; top: 0; z-index: 40;
  border-bottom: 1px solid color-mix(in srgb, var(--status-panel-border) 85%, transparent);
  background: color-mix(in srgb, var(--status-panel-bg, #fff) 78%, transparent);
  backdrop-filter: blur(22px) saturate(1.4); -webkit-backdrop-filter: blur(22px) saturate(1.4);
}
${R} .status-topbar__inner,
${R} .status-v3,
${R} .status-site-footer__inner,
${R} .status-subscribe-block {
  max-inline-size: var(--status-content-width, 72rem);
  margin-inline: auto;
  padding-inline: clamp(1rem, 4vw, 1.75rem);
}
${R} .status-topbar__inner {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding-block: .85rem; min-block-size: 4rem;
}
${R} .status-topbar__brand {
  display: inline-flex; align-items: center; gap: .8rem; min-inline-size: 0;
  color: var(--status-text-strong); text-decoration: none;
  font-family: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif;
  font-weight: 650; font-size: 1.2rem; letter-spacing: -.02em;
}
${R} .status-topbar__brand:hover { color: var(--primary); }
${R} .status-topbar__brand img {
  height: 2.05rem; max-inline-size: 10rem;
  width: auto; display: block; object-fit: contain;
}
${R} .status-topbar__brand span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${R} .status-topbar__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: .45rem; }
${R} .status-topbar__chip {
  display: inline-flex; align-items: center; gap: .45rem;
  padding: .46rem .82rem; border: 1px solid var(--status-panel-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--status-panel-bg) 70%, transparent);
  color: var(--status-text); font-size: .78rem; font-weight: 620;
  text-decoration: none; line-height: 1; letter-spacing: .01em;
  transition: border-color .15s ease, background .15s ease, color .15s ease, box-shadow .15s ease;
}
${R} a.status-topbar__chip:hover {
  color: var(--status-text-strong);
  border-color: color-mix(in srgb, var(--primary) 45%, var(--status-panel-border));
  background: color-mix(in srgb, var(--primary) 8%, var(--status-panel-bg));
  box-shadow: 0 6px 16px -12px color-mix(in srgb, var(--primary) 55%, transparent);
}
${R} a.status-topbar__chip:focus-visible {
  outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 28%, transparent);
}
${R} .status-topbar__chip svg { flex: none; opacity: .85; }
${R} .status-topbar__chip--time {
  gap: .5rem; color: var(--status-text-muted); cursor: default;
  font-variant-numeric: tabular-nums;
}
${R} .status-topbar__time { color: var(--status-text-strong); font-weight: 680; }
${R} .status-topbar__offset {
  padding-inline-start: .5rem; margin-inline-start: .05rem;
  border-inline-start: 1px solid var(--status-panel-border);
  color: var(--status-text-subtle); font-weight: 600; font-size: .72rem; letter-spacing: .04em;
}
${R} .status-topbar__chip--accent {
  background: var(--primary); border-color: var(--primary); color: var(--status-text-inverse);
}
${R} a.status-topbar__chip--accent:hover {
  background: var(--primary-hover); border-color: var(--primary-hover); color: var(--status-text-inverse);
  box-shadow: 0 8px 18px -10px color-mix(in srgb, var(--primary) 70%, transparent);
}

${R} .status-v3 { padding-block: clamp(1.75rem, 4vw, 2.75rem) 0; gap: clamp(2rem, 5vw, 3.25rem); }
${R} .status-v3 > section > h2 {
  position: static; padding-inline-start: 0; display: block;
  font-size: 1.15rem; font-weight: 650; letter-spacing: -.02em; margin: 0 0 1rem;
}
${R} .status-v3 > section > h2::before { display: none; }

${R} .status-v3-hero {
  display: grid; gap: 1rem 2rem; align-items: center;
  grid-template-columns: minmax(0, 1fr);
  padding: 1.05rem 1.15rem;
  border: 1px solid var(--status-panel-border);
  border-inline-start: 3px solid var(--v3-accent, var(--primary));
  border-radius: 10px;
  background:
    radial-gradient(140% 180% at 100% 0%, color-mix(in srgb, var(--v3-accent, var(--primary)) 7%, transparent), transparent 62%),
    var(--status-panel-bg);
  box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
}
${R} .status-v3-hero::before { display: none; }
${R} .status-v3-hero__main {
  display: grid; gap: .3rem; min-inline-size: 0;
}
${R} .status-v3-hero__status-row {
  display: inline-flex; align-items: center; gap: .5rem;
  margin-block-end: .15rem;
}
${R} .status-v3-hero__live {
  flex: none;
  inline-size: .5rem; block-size: .5rem; border-radius: 999px;
  background: var(--v3-accent, var(--primary));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--v3-accent, var(--primary)) 16%, transparent);
}
${R} .status-v3-hero__copy { display: grid; gap: .2rem; min-inline-size: 0; }
${R} .status-v3-hero h1 {
  margin: 0; text-wrap: balance;
  font-family: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(1.2rem, 2.1vw, 1.5rem); font-weight: 700; letter-spacing: -.03em; line-height: 1.2;
  color: var(--status-text-strong);
}
${R} .status-v3-hero__note, ${R} .status-v3-hero__confidence {
  margin: 0; max-inline-size: 40rem; color: var(--status-text-muted); font-size: .84rem; line-height: 1.5;
}
${R} .status-v3-hero__updated { color: var(--status-text-subtle); font-size: .8rem; }
${R} .status-v3-hero__confidence { font-size: .78rem; color: var(--status-text-subtle); }
${R} .status-v3-hero__stats {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0; margin: 0;
  border-block-start: 1px solid var(--status-panel-border);
  padding-block-start: .75rem;
}
${R} .status-v3-hero__stats .status-stat {
  display: grid; gap: .08rem; min-inline-size: 6rem;
  padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none;
}
${R} .status-v3-hero__stats .status-stat + .status-stat {
  padding-inline-start: 1.1rem; border-inline-start: 1px solid var(--status-panel-border);
}
${R} .status-v3-hero__stats .status-stat__label {
  font-size: .62rem; font-weight: 650; letter-spacing: .07em; text-transform: uppercase;
  color: var(--status-text-subtle);
}
${R} .status-v3-hero__stats .status-stat__value {
  font-family: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: 1.35rem; font-weight: 700; letter-spacing: -.03em;
  font-variant-numeric: tabular-nums; color: var(--status-text-strong); line-height: 1.15;
}
${R} .status-v3-hero__stats .status-stat__hint { font-size: .72rem; color: var(--status-text-muted); }
@media (min-width: 52rem) {
  ${R} .status-v3-hero { grid-template-columns: minmax(0, 1fr) auto; }
  ${R} .status-v3-hero__stats { border-block-start: 0; padding-block-start: 0; }
}
@media (min-width: 90rem) {
  ${R} .status-v3-hero__stats { display: flex; grid-template-columns: none; }
}
@media (max-width: 40rem) {
  ${R} .status-v3-hero__stats { width: 100%; }
  ${R} .status-v3-hero__stats .status-stat { flex: 1 1 0; min-inline-size: 0; }
}

${R} .status-v3-service, ${R} .status-v3-region, ${R} .status-v3-maintenance__item,
${R} .status-v3-incident, ${R} .status-v3-announcement, ${R} .status-v3-changelog__item {
  box-shadow: none; transform: none; border-radius: 4px;
  border: 1px solid var(--status-panel-border);
  border-inline-start-width: 1px;
  background: color-mix(in srgb, var(--status-panel-bg) 96%, transparent);
}
${R} .status-v3-service:hover, ${R} .status-v3-region:hover, ${R} .status-v3-incident:hover {
  transform: none; box-shadow: none;
  border-color: color-mix(in srgb, var(--v3-accent, var(--primary)) 28%, var(--status-panel-border));
}
${R} .status-v3-service__head { align-items: center; }
${R} .status-v3-service__name { font-weight: 620; font-size: .98rem; }

/* ---- Services Section (V3) - Ultra-Compact Architecture ---- */
${R} .status-v3-services {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

${R} .status-v3-services__top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1.25rem;
  flex-wrap: wrap;
  padding-block-end: 0.65rem;
  border-block-end: 1px solid var(--status-panel-border);
}

${R} .status-v3-services__title-group {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

${R} .status-v3-services__title {
  margin: 0;
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--status-text-strong);
}

${R} .status-v3-services__tally-pill {
  font-size: 0.725rem;
  font-weight: 600;
  color: var(--status-text-subtle);
  background: color-mix(in srgb, var(--status-panel-muted-bg, #f8fafc) 90%, transparent);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  border-radius: 4px;
  padding: 0.15rem 0.5rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

${R} .status-v3-services__group-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--status-panel-border);
  border-radius: 4px;
  background: var(--status-panel-bg);
  color: var(--status-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
  white-space: nowrap;
}

${R} .status-v3-services__group-btn:hover {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--status-panel-border));
  color: var(--status-text-strong);
}

${R} .status-v3-services__group-btn--active,
${R} .status-v3-services__group-btn[aria-pressed="true"] {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 45%, var(--status-panel-border));
  background: color-mix(in srgb, var(--primary) 10%, var(--status-panel-bg));
  font-weight: 650;
}

${R} .status-v3-services__group-icon {
  flex-shrink: 0;
  opacity: 0.75;
}

${R} .status-v3-services__right-group {
  display: flex;
  align-items: center;
  gap: 0.75rem 1.15rem;
  flex-wrap: wrap;
}

/* Micro search input */
${R} .status-v3-services .status-v3-search {
  position: relative;
  display: flex;
  align-items: center;
  width: 9.5rem;
}

${R} .status-v3-search__icon {
  position: absolute;
  inset-inline-start: 0.55rem;
  color: var(--status-text-subtle);
  pointer-events: none;
}

${R} .status-v3-services .status-v3-search input {
  width: 100%;
  height: 28px;
  padding: 0 0.55rem 0 1.65rem;
  border-radius: 4px;
  font-size: 0.78rem;
  border: 1px solid var(--status-panel-border);
  background: var(--status-panel-bg);
  color: var(--status-text-strong);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

${R} .status-v3-services .status-v3-search input:focus {
  border-color: var(--primary);
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 20%, transparent);
}

/* Interactive Filter Chips */
${R} .status-v3-filters {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

${R} .status-v3-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border: 1px solid var(--status-panel-border);
  border-radius: 4px;
  background: var(--status-panel-bg);
  color: var(--status-text-muted);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background-color 0.15s ease;
  white-space: nowrap;
  line-height: 1.25;
}

${R} .status-v3-filter-chip:hover {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--status-panel-border));
  color: var(--status-text-strong);
}

${R} .status-v3-filter-chip--active,
${R} .status-v3-filter-chip[aria-pressed="true"] {
  background: color-mix(in srgb, var(--primary) 12%, var(--status-panel-bg));
  border-color: color-mix(in srgb, var(--primary) 50%, var(--status-panel-border));
  color: var(--primary);
  font-weight: 650;
}

${R} .status-v3-legend-indicator {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
  flex-shrink: 0;
}

${R} .status-v3-legend-indicator--operational {
  background-color: #10b981;
}

${R} .status-v3-legend-indicator--degraded {
  background-color: #f59e0b;
}

${R} .status-v3-legend-indicator--outage {
  background-color: #ef4444;
}

${R} .status-v3-legend-indicator--maintenance {
  background-color: #3b82f6;
}

${R} .status-v3-services__legend-divider {
  width: 1px;
  height: 11px;
  background: var(--status-panel-border);
  display: inline-block;
}

${R} .status-v3-services__legend-window {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--status-text-subtle);
}

${R} .status-v3-legend-clock {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}

${R} .status-v3-services__list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  width: 100%;
  list-style: none;
  padding: 0;
  margin: 0;
}

${R} .status-v3-services .status-v3-service {
  display: flex;
  flex-direction: column;
  width: 100%;
  gap: 0.45rem;
  padding: 0.65rem 0.9rem;
  border-radius: 4px;
  background: var(--status-panel-bg, #ffffff);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-inline-size: 0;
  content-visibility: auto;
  contain-intrinsic-size: auto 140px;
}

${R} .status-v3-services .status-v3-service:hover {
  border-color: color-mix(in srgb, var(--primary) 25%, var(--status-panel-border));
  box-shadow: 0 2px 5px rgba(15, 23, 42, 0.05);
}

${R} .status-v3-services .status-v3-service--affected {
  border-inline-start: 3px solid var(--v3-accent, var(--primary));
}

${R} .status-v3-inspector[data-status]:not([data-status="operational"]) {
  border-inline-start: 3px solid var(--v3-accent, var(--primary));
}

${R} .status-v3-service__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  flex-wrap: wrap;
}

${R} .status-v3-service__lead {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem 0.65rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

${R} .status-v3-service__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}

${R} .status-v3-services .status-v3-service__name {
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-weight: 650;
  font-size: 0.85rem;
  color: var(--status-text-strong);
  letter-spacing: -0.015em;
}

${R} .status-v3-service__meta {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem 0.4rem;
  flex-wrap: wrap;
}

${R} .status-v3-service__meta .status-v3-chip {
  font-size: 0.68rem;
  padding: 0.08rem 0.4rem;
  border-radius: 3px;
  border-color: transparent;
  background: color-mix(in srgb, var(--status-panel-muted-bg, #f8fafc) 80%, transparent);
}

${R} .status-v3-service__badges {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}
${R} .status-v3-service__badges [data-badge="true"] {
  letter-spacing: 0;
}

${R} .status-v3-services .status-v3-service__desc {
  margin: 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--status-text-muted);
}

${R} .status-v3-filters .status-v3-chip__count {
  font-variant-numeric: tabular-nums; color: var(--status-text-subtle); font-weight: 650;
}

/* Services Empty Filter State */
${R} .status-v3-services__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2.25rem 1.25rem;
  margin-block: 0.85rem;
  border: 1px dashed var(--status-panel-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--status-panel-muted-bg, #f8fafc) 60%, transparent);
}

${R} .status-v3-services__empty-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--status-panel-border) 40%, transparent);
  color: var(--status-text-subtle);
  margin-block-end: 0.65rem;
}

${R} .status-v3-services__empty-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--status-text-strong);
}

${R} .status-v3-services__empty-hint {
  margin: 0.25rem 0 0;
  font-size: 0.78rem;
  color: var(--status-text-muted);
  max-width: 22rem;
  line-height: 1.4;
}

${R} .status-v3-services__empty-reset {
  margin-block-start: 0.75rem;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--status-panel-border);
  border-radius: 4px;
  background: var(--status-panel-bg);
  color: var(--primary);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

${R} .status-v3-services__empty-reset:hover {
  background: color-mix(in srgb, var(--primary) 10%, var(--status-panel-bg));
  border-color: color-mix(in srgb, var(--primary) 50%, var(--status-panel-border));
}

/* ---- Card-less Inline Maintenance Section — status-page standard ---- */
${R} .status-v3-maintenance-inline {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
${R} .status-v3-maintenance-inline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  flex-wrap: wrap;
  padding-block-end: 0.55rem;
  border-block-end: 1px solid var(--status-panel-border);
}
${R} .status-v3-maintenance-inline__title-wrap {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  flex-wrap: wrap;
}
${R} .status-v3-maintenance-inline__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--status-text-strong);
  font-family: 'Space Grotesk', Inter, sans-serif;
}
${R} .status-v3-maintenance-inline__subtitle {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--status-text-muted);
  letter-spacing: 0.01em;
}
${R} .status-v3-maintenance-inline__tally {
  display: inline-flex;
  align-items: center;
}
${R} .status-v3-maintenance-inline__tally-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
${R} .status-v3-maintenance-inline__dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  display: inline-block;
}
${R} .status-v3-maintenance-inline__tally-pill--active {
  color: #b45309;
  background: #fef3c7;
  border: 1px solid rgba(180, 83, 9, 0.2);
}
${R} .status-v3-maintenance-inline__tally-pill--active .status-v3-maintenance-inline__dot {
  background-color: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.25);
}
${R} .status-v3-maintenance-inline__tally-pill--scheduled {
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid rgba(29, 78, 216, 0.2);
}
${R} .status-v3-maintenance-inline__tally-pill--scheduled .status-v3-maintenance-inline__dot {
  background-color: #3b82f6;
}
${R} .status-v3-maintenance-inline__tally-pill--completed {
  color: #475569;
  background: #f1f5f9;
  border: 1px solid rgba(71, 85, 105, 0.18);
}
${R} .status-v3-maintenance-inline__tally-pill--completed .status-v3-maintenance-inline__dot {
  background-color: #94a3b8;
}
${R} .status-v3-maintenance-inline__list {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.5rem;
}
${R} .status-v3-maintenance-pill {
  display: inline-flex;
  flex-direction: column;
  flex: 1 1 calc(50% - 0.5rem);
  min-inline-size: min(100%, 22rem);
  gap: 0.3rem;
  padding: 0.55rem 0.75rem;
  border-radius: 4px;
  background: var(--status-panel-bg, #ffffff);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-inline-size: 0;
}
${R} .status-v3-maintenance-pill--active {
  border-inline-start: 3px solid #f59e0b;
}
${R} .status-v3-maintenance-pill--scheduled {
  border-inline-start: 3px solid #3b82f6;
}
${R} .status-v3-maintenance-pill--completed {
  border-inline-start: 3px solid #cbd5e1;
  opacity: 0.96;
}
${R} .status-v3-maintenance-pill:hover {
  border-color: color-mix(in srgb, var(--primary) 25%, var(--status-panel-border));
  box-shadow: 0 2px 5px rgba(15, 23, 42, 0.05);
}

${R} .status-v3-maintenance-pill__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  flex-wrap: wrap;
}

${R} .status-v3-maintenance-pill__lead {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

${R} .status-v3-maintenance-pill__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}

${R} .status-v3-maintenance-pill__title {
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-weight: 650;
  font-size: 0.85rem;
  color: var(--status-text-strong);
  letter-spacing: -0.01em;
}

${R} .status-v3-maintenance-pill__divider {
  width: 1px;
  height: 11px;
  background: var(--status-panel-border);
  display: inline-block;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  ${R} .status-v3-maintenance-pill__divider,
  ${R} .status-v3-inspector__divider {
    display: none;
  }
}

${R} .status-v3-maintenance-pill__time {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--status-text-subtle);
}

${R} .status-v3-maintenance-pill__status {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

${R} .status-v3-maintenance-pill__desc {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--status-text-muted);
}

${R} .status-v3-maintenance-pill__meta {
  display: flex;
  align-items: center;
  gap: 0.35rem 0.45rem;
  flex-wrap: wrap;
  margin-block-start: 0.2rem;
}

${R} .status-v3-maintenance-pill__affected-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--status-text-subtle);
}

/* ---- Announcements & Changelog — status-page standard ---- */
${R} .status-v3-announcements-inline,
${R} .status-v3-changelog-inline {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
${R} .status-v3-announcements-inline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 1rem;
  flex-wrap: wrap;
  padding-block-end: 0.55rem;
  border-block-end: 1px solid var(--status-panel-border);
}
${R} .status-v3-announcements-inline__title-wrap {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  flex-wrap: wrap;
}
${R} .status-v3-announcements-inline__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--status-text-strong);
  font-family: 'Space Grotesk', Inter, sans-serif;
}
${R} .status-v3-announcements-inline__subtitle {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--status-text-muted);
  letter-spacing: 0.01em;
}
${R} .status-v3-announcements-inline__tally {
  display: inline-flex;
  align-items: center;
}
${R} .status-v3-announcements-inline__tally-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  color: var(--status-text-strong, #334155);
  background: color-mix(in srgb, var(--status-panel-muted-bg, #f1f5f9) 90%, transparent);
  border: 1px solid var(--status-panel-border, #e2e8f0);
}
${R} .status-v3-announcements-inline__tally-pill--changelog {
  background: #f8fafc;
}
${R} .status-v3-announcements-inline__dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  display: inline-block;
  background-color: #64748b;
}
${R} .status-v3-announcements-inline__tally-pill--changelog .status-v3-announcements-inline__dot {
  background-color: #94a3b8;
}
${R} .status-v3-announcements-inline__list {
  display: grid;
  gap: 0.5rem;
}
${R} .status-v3-changelog-inline {
  margin-block-start: 0.75rem;
}
${R} .status-v3-changelog-inline__list {
  display: grid;
  gap: 0.5rem;
}
${R} .status-v3-changelog-pill {
  display: flex;
  flex-direction: column;
  flex: none;
  inline-size: 100%;
  gap: 0.3rem;
  padding: 0.55rem 0.75rem;
  border-radius: 4px;
  background: var(--status-panel-bg, #ffffff);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  border-inline-start: 3px solid #cbd5e1;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-inline-size: 0;
}
${R} .status-v3-changelog-pill:hover {
  border-color: color-mix(in srgb, var(--primary) 25%, var(--status-panel-border));
  box-shadow: 0 2px 5px rgba(15, 23, 42, 0.05);
}
${R} .status-v3-changelog-pill__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  flex-wrap: wrap;
}
${R} .status-v3-changelog-pill__lead {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}
${R} .status-v3-changelog-pill__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}
${R} .status-v3-changelog-pill__title {
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-weight: 650;
  font-size: 0.85rem;
  color: var(--status-text-strong);
  letter-spacing: -0.01em;
}
${R} .status-v3-changelog-pill__divider {
  width: 1px;
  height: 11px;
  background: var(--status-panel-border);
  display: inline-block;
  flex-shrink: 0;
}
@media (max-width: 640px) {
  ${R} .status-v3-changelog-pill__divider { display: none; }
}
${R} .status-v3-changelog-pill__time {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--status-text-subtle);
}
${R} .status-v3-changelog-pill__desc {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--status-text-muted);
}
${R} .status-v3-changelog-pill__meta {
  display: flex;
  align-items: center;
  gap: 0.35rem 0.45rem;
  flex-wrap: wrap;
  margin-block-start: 0.2rem;
}
${R} .status-v3-changelog-pill__affected-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--status-text-subtle);
}

${R} .status-v3-announcement-pill {
  display: flex;
  flex-direction: column;
  flex: none;
  inline-size: 100%;
  gap: 0.3rem;
  padding: 0.55rem 0.75rem;
  border-radius: 4px;
  background: var(--status-panel-bg, #ffffff);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-inline-size: 0;
}

${R} .status-v3-announcement-pill:hover {
  border-color: color-mix(in srgb, var(--primary) 25%, var(--status-panel-border));
}

${R} .status-v3-announcement-pill--warning {
  border-inline-start: 3px solid #f59e0b;
}

${R} .status-v3-announcement-pill--incident {
  border-inline-start: 3px solid #ef4444;
}

${R} .status-v3-announcement-pill--maintenance {
  border-inline-start: 3px solid #3b82f6;
}

${R} .status-v3-announcement-pill--info {
  border-inline-start: 3px solid var(--primary);
}

${R} .status-v3-announcement-pill__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem 1rem;
  flex-wrap: wrap;
}

${R} .status-v3-announcement-pill__lead {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

${R} .status-v3-announcement-pill__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}

${R} .status-v3-announcement-pill__title {
  font-family: 'Space Grotesk', Inter, sans-serif;
  font-weight: 650;
  font-size: 0.85rem;
  color: var(--status-text-strong);
  letter-spacing: -0.01em;
}

${R} .status-v3-announcement-pill__divider {
  width: 1px;
  height: 11px;
  background: var(--status-panel-border);
  display: inline-block;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  ${R} .status-v3-announcement-pill__divider {
    display: none;
  }
}

${R} .status-v3-announcement-pill__time {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--status-text-subtle);
}

${R} .status-v3-announcement-pill__status {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

${R} .status-v3-announcement-pill__desc {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--status-text-muted);
}

${R} .status-v3-announcement-pill__meta {
  display: flex;
  align-items: center;
  gap: 0.35rem 0.45rem;
  flex-wrap: wrap;
  margin-block-start: 0.2rem;
}

${R} .status-v3-announcement-pill__affected-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--status-text-subtle);
}
${R} .status-v3-announcement-pill__desc--clamped,
${R} .status-v3-changelog-pill__desc--clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
${R} .status-v3-pill__expand {
  align-self: flex-start;
  margin-block-start: 0.05rem;
  padding: 0;
  border: 0;
  background: none;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.2;
}
${R} .status-v3-pill__expand:hover { text-decoration: underline; text-underline-offset: 2px; }
${R} .status-v3-pill__expand:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 30%, transparent);
  outline-offset: 2px;
  border-radius: 2px;
}
${R} .status-v3-pill__more {
  display: inline-flex;
  align-items: center;
  padding: 0.08rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--status-panel-border);
  background: var(--status-panel-muted-bg);
  color: var(--status-text-muted);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  line-height: 1.2;
  white-space: nowrap;
}
${R} .status-v3-pill__more:hover {
  border-color: color-mix(in srgb, var(--primary) 35%, var(--status-panel-border));
  color: var(--status-text-strong);
}
${R} .status-v3-pill__more:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--primary) 30%, transparent);
  outline-offset: 1px;
}

/* ---- Card-less Inline Regions Strip ---- */
${R} .status-v3-regions-inline {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-block-end: 1.5rem;
}

${R} .status-v3-regions-inline__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

${R} .status-v3-regions-inline__title-wrap {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  flex-wrap: wrap;
}

${R} .status-v3-regions-inline__title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--status-text-strong);
  font-family: 'Space Grotesk', Inter, sans-serif;
}

${R} .status-v3-regions-inline__subtitle {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--status-text-muted);
  letter-spacing: 0.01em;
}

${R} .status-v3-regions-inline__tally {
  display: inline-flex;
  align-items: center;
}

${R} .status-v3-regions-inline__tally-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.725rem;
  font-weight: 600;
  padding: 0.18rem 0.55rem;
  border-radius: 4px;
  letter-spacing: 0.01em;
}

${R} .status-v3-regions-inline__dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  display: inline-block;
}

${R} .status-v3-regions-inline__tally-pill--healthy {
  color: #047857;
  background: #ecfdf5;
  border: 1px solid rgba(4, 120, 87, 0.18);
}
${R} .status-v3-regions-inline__tally-pill--healthy .status-v3-regions-inline__dot {
  background-color: #10b981;
}

${R} .status-v3-regions-inline__tally-pill--impacted {
  color: #ef4444;
  background: #fef2f2;
  border: 1px solid rgba(239, 68, 68, 0.2);
}
${R} .status-v3-regions-inline__tally-pill--impacted .status-v3-regions-inline__dot {
  background-color: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
}

${R} .status-v3-regions-inline__list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

${R} .status-v3-region-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.65rem;
  border-radius: 4px;
  background: var(--status-panel-bg, #ffffff);
  border: 1px solid var(--status-panel-border, #e2e8f0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  min-inline-size: 0;
}

${R} .status-v3-region-pill:hover {
  border-color: color-mix(in srgb, var(--primary) 40%, var(--status-panel-border, #e2e8f0));
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.06);
  transform: translateY(-1px);
}

${R} .status-v3-region-pill__lead {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-inline-size: 0;
}

${R} .status-v3-region-pill__icon {
  color: var(--status-text-subtle);
  flex-shrink: 0;
}

${R} .status-v3-region-pill__name {
  font-weight: 650;
  font-size: 0.8125rem;
  letter-spacing: -0.01em;
  color: var(--status-text-strong);
  font-family: 'Space Grotesk', Inter, sans-serif;
  white-space: nowrap;
}

${R} .status-v3-region-pill__divider {
  width: 1px;
  height: 12px;
  background: color-mix(in srgb, var(--status-panel-border, #e2e8f0) 80%, transparent);
  margin-inline-start: 0.15rem;
  flex-shrink: 0;
}

${R} .status-v3-region-pill__status {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

${R} .status-v3-region-pill .status-badge,
${R} .status-v3-region-pill [data-badge="true"] {
  font-size: 0.6875rem;
  padding: 0.12rem 0.45rem;
}

@media (max-width: 32rem) {
  ${R} .status-v3-region-pill {
    width: 100%;
    justify-content: space-between;
    padding: 0.45rem 0.75rem;
  }
}

${R} .status-site-footer {
  margin-block-start: clamp(3rem, 8vw, 5rem);
  padding-block: 2.75rem 2rem;
  border-top: 1px solid var(--status-panel-border);
  background: color-mix(in srgb, var(--status-panel-muted-bg) 55%, transparent);
}
${R} .status-site-footer__grid {
  display: grid; gap: 2rem 1.5rem;
  grid-template-columns: minmax(12rem, 1.3fr) repeat(3, minmax(8rem, 1fr));
}
${R} .status-site-footer h2 {
  margin: 0 0 .85rem; font-size: .68rem; font-weight: 650;
  letter-spacing: .08em; text-transform: uppercase; color: var(--status-text-subtle);
}
${R} .status-site-footer nav { display: grid; gap: .4rem; align-content: start; }
${R} .status-site-footer .status-footer-link {
  color: var(--status-text-muted); text-decoration: none; font-size: .875rem;
}
${R} .status-site-footer .status-footer-link:hover { color: var(--status-text-strong); }
${R} .status-site-footer__brand { display: grid; gap: .55rem; align-content: start; }
${R} .status-site-footer__logo {
  color: var(--status-text-strong); text-decoration: none;
  font-family: 'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif;
  font-weight: 700; font-size: 1.15rem; letter-spacing: -.02em;
}
${R} .status-site-footer__brand p { margin: 0; max-inline-size: 22rem; color: var(--status-text-muted); font-size: .875rem; line-height: 1.55; }
${R} .status-site-footer__legal {
  margin: 2.25rem 0 0; padding-top: 1.25rem; border-top: 1px solid var(--status-panel-border);
  color: var(--status-text-subtle); font-size: .75rem;
}
${R} .status-subscribe-block { padding-block: 1.5rem 0; }

@media (max-width: 48rem) {
  ${R} .status-topbar { position: sticky; }
  ${R} .status-topbar__inner { flex-wrap: wrap; }
  ${R} .status-site-footer__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 40rem) {
  ${R} .status-site-footer__grid { grid-template-columns: minmax(0, 1fr); }
}
`;
