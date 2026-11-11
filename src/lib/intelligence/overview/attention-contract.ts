/**
 * Shape of the overview's "Needs attention" inbox. Dependency-free so the component that renders it can
 * be used (and tested) without the server-only loader.
 */

export type AttentionKind = 'triage' | 'related' | 'gate' | 'dependencies' | 'quarantine';

export const ATTENTION_KIND_LABELS: Readonly<Record<AttentionKind, string>> = {
  triage: 'Triage',
  related: 'Related incidents',
  gate: 'Ready for AUTO',
  dependencies: 'Dependencies',
  quarantine: 'Failed work',
};

export interface AttentionItem {
  /** Stable within one render; used as the list key and the e2e handle. */
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  /** The exact place to act. */
  href: string;
}

export interface OverviewAttention {
  items: AttentionItem[];
}
