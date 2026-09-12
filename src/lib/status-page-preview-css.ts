import { STATUS_PAGE_PUBLIC_CSS } from '@/lib/status-pages/public-css';

/**
 * Baseline styles for the admin preview's ShadowRoot.
 *
 * The shared public stylesheet is appended verbatim rather than restated, so the preview cannot
 * drift from the live page: the two surfaces render the same components against the same rules.
 * What remains here is only what a shadow root needs and a document does not -- the `:host` reset
 * and the admin-shell form controls the preview chrome reuses. Customer CSS is injected after this
 * baseline so its normal cascade wins.
 */
export const STATUS_PAGE_PREVIEW_BASE_CSS = `
:host {
  display: block;
  color: inherit;
  font: inherit;
}

*, *::before, *::after {
  box-sizing: border-box;
}

button, input, select, textarea {
  color: inherit;
  font: inherit;
}

.status-page-input,
.status-page-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  background: #ffffff;
  color: inherit;
}

.status-page-input:focus,
.status-page-input:focus-visible,
.status-page-select:focus,
.status-page-select:focus-visible {
  border-color: var(--status-primary, #2563eb);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-primary, #2563eb) 18%, transparent);
  outline: none;
}

.status-page-button {
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.status-page-button:disabled,
.status-page-button[aria-disabled="true"] {
  opacity: 0.6;
  cursor: not-allowed;
}

.status-page-button[data-active="true"] {
  background: var(--status-primary, #2563eb);
  border-color: var(--status-primary, #2563eb);
  color: #ffffff;
  font-weight: 600;
}

.status-page-button[data-variant="primary"] {
  background: var(--status-primary, #0f172a);
  border-color: var(--status-primary, #0f172a);
  color: #ffffff;
  font-weight: 600;
  border-radius: 0.625rem;
  padding: 0.625rem 1.25rem;
}

.status-page-button:focus,
.status-page-button:focus-visible {
  border-color: var(--status-primary, #2563eb);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--status-primary, #2563eb) 18%, transparent);
  outline: none;
}

.status-page-button:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.status-page-button[data-active="true"]:hover,
.status-page-button[data-variant="primary"]:hover {
  background: var(--status-primary-hover, #1d4ed8);
  border-color: var(--status-primary-hover, #1d4ed8);
  box-shadow: 0 6px 14px color-mix(in srgb, var(--status-primary, #2563eb) 22%, transparent);
}

${STATUS_PAGE_PUBLIC_CSS}

/* ---- Preview Responsive Device & Container Adaptations ---- */
.status-page-container[data-device-view="iphone"] .status-v3-hero {
  display: flex !important;
  flex-direction: column !important;
  gap: 1.25rem !important;
  align-items: stretch !important;
}

.status-page-container[data-device-view="iphone"] .status-v3-hero__stats {
  display: grid !important;
  grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  width: 100% !important;
  border-block-start: 1px solid var(--status-panel-border) !important;
  padding-block-start: 0.75rem !important;
  gap: 0.75rem !important;
}

.status-page-container[data-device-view="iphone"] .status-v3-hero__stats .status-stat {
  flex: 1 1 0 !important;
  min-inline-size: 0 !important;
}

.status-page-container[data-device-view="iphone"] .status-topbar__inner {
  flex-wrap: wrap !important;
  gap: 0.5rem !important;
  justify-content: space-between !important;
}

.status-page-container[data-device-view="iphone"] .status-topbar__actions {
  flex-wrap: wrap !important;
  justify-content: flex-start !important;
  gap: 0.35rem !important;
}

.status-page-container[data-device-view="iphone"] .status-subscribe__controls {
  flex-direction: column !important;
}

.status-page-container[data-device-view="iphone"] .status-subscribe__button {
  width: 100% !important;
}

.status-page-container[data-device-view="iphone"] .status-v3-services__list {
  grid-template-columns: minmax(0, 1fr) !important;
}

.status-page-container[data-device-view="iphone"] .status-v3-service__head {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.5rem !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
}

.status-page-container[data-device-view="iphone"] .status-region-grid,
.status-page-container[data-device-view="iphone"] .status-uptime-grid {
  grid-template-columns: minmax(0, 1fr) !important;
}

.status-page-container[data-device-view="ipad"] .status-v3-services__list {
  grid-template-columns: minmax(0, 1fr) !important;
}

.status-page-container[data-device-view="ipad"] .status-v3-hero__stats {
  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
}
`;
