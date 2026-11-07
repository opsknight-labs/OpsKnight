import type { SavedActionReference } from '@/lib/intelligence/conversations/contract';
import type { SquireProposalView } from './SquireProposalCard';
export type Citation = {
  kind: 'incident' | 'runbook' | 'change' | 'alert' | 'service' | 'schedule' | 'postmortem';
  id: string;
  label: string;
  href: string;
  observedAt?: string;
  why?: string;
};
export type Turn = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  contextProof?: string;
  notice?: string;
  mode?: 'ai' | 'basic';
  /** The deterministic intent a basic answer was built for; sent with feedback. */
  intent?: string;
  /** What the assistant is looking up right now. */
  activity?: string;
  /** Shown after partial text when the answer was cut off. */
  error?: string;
  failed?: boolean;
  proposals?: SquireProposalView[];
  savedActions?: SavedActionReference[];
  citations?: Citation[];
  suggestions?: string[];
  /** The incident page the turn was asked on; history only carries turns from the same page. */
  incidentId?: string;
};
