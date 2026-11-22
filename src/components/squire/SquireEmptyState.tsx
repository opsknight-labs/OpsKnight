'use client';

import {
  BarChart3,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Flame,
  GitCompareArrows,
  History,
  Inbox,
  Layers,
  MessageSquare,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import OpsKnightSquire, { type SquireState } from './OpsKnightSquire';

/** An icon per suggested question, by what it asks about; anything else gets a speech bubble. */
const INTENT_ICONS: Array<[RegExp, LucideIcon]> = [
  [/fire/i, Flame],
  [/similar|seen this/i, History],
  [/cause|changed/i, GitCompareArrows],
  [/runbook/i, BookOpen],
  [/assigned|on call|who /i, UserRound],
  [/my open/i, Inbox],
  [/how many/i, BarChart3],
  [/services/i, Layers],
  [/^help$/i, CircleHelp],
];
const iconFor = (text: string) =>
  INTENT_ICONS.find(([pattern]) => pattern.test(text))?.[1] ?? MessageSquare;

function SuggestionList({
  title,
  items,
  onAsk,
}: {
  title: string;
  items: readonly string[];
  onAsk: (text: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map(text => {
          const Icon = iconFor(text);
          return (
            <li key={text}>
              <button
                type="button"
                onClick={() => onAsk(text)}
                aria-label={text}
                className="flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">{text}</span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** First screen of a conversation: a short greeting and suggested questions grouped by scope. */
export default function SquireEmptyState({
  showMascot,
  mascotState,
  animated,
  description,
  incidentSuggestions,
  workspaceSuggestions,
  onAsk,
}: {
  showMascot: boolean;
  mascotState: SquireState;
  animated: boolean;
  description: string;
  incidentSuggestions: readonly string[];
  workspaceSuggestions: readonly string[];
  onAsk: (text: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        {showMascot && (
          <span aria-hidden="true" className="shrink-0">
            <OpsKnightSquire state={mascotState} size={40} animated={animated} label="" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            What are we investigating?
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <SuggestionList title="For this incident" items={incidentSuggestions} onAsk={onAsk} />
      <SuggestionList title="Across your workspace" items={workspaceSuggestions} onAsk={onAsk} />
    </div>
  );
}
