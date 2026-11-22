'use client';

import {
  ArrowLeftRight,
  History,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelRight,
  PictureInPicture2,
  Plus,
  X,
} from 'lucide-react';
import SquireAvatar, { type SquireAvatarKind } from './SquireAvatar';
import type { SquireState } from './OpsKnightSquire';
import type { SquireDock } from './dock';
import { toneClasses } from '@/components/patterns/status-tone';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';

/** Header icon buttons: 44 px on phones and in the full-screen presentation, compact in the desktop panel. */
export const squireIconButton = (fullscreen: boolean) =>
  `inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${fullscreen ? 'h-11 w-11' : 'h-11 w-11 sm:h-8 sm:w-8'}`;

/**
 * One row: avatar, name, what the conversation is about, then New chat, History, More and Close. The
 * display controls (expand, dock, side) live in the More menu; the menu is left out when none apply.
 */
export default function SquireHeader({
  name,
  avatar,
  animated,
  mascotState,
  statusLabel,
  context,
  fullscreen,
  dock,
  side,
  expanded,
  onToggleExpanded,
  onSwitchSide,
  hasHistory,
  showHistory,
  onToggleHistory,
  onNewChat,
  onClose,
}: {
  name: string;
  avatar: SquireAvatarKind;
  animated: boolean;
  mascotState: SquireState;
  statusLabel: string;
  context: { label: string; title: string; urgent: boolean };
  fullscreen: boolean;
  dock: SquireDock;
  side: 'left' | 'right';
  expanded: boolean;
  /** Null when the panel cannot be widened (docked or full screen). */
  onToggleExpanded: (() => void) | null;
  /** Null when the panel has no side to move to (docked or full screen). */
  onSwitchSide: (() => void) | null;
  hasHistory: boolean;
  showHistory: boolean;
  onToggleHistory: () => void;
  onNewChat: () => void;
  onClose: () => void;
}) {
  const iconButton = squireIconButton(fullscreen);
  const hasMenu = Boolean(onToggleExpanded || dock.available || onSwitchSide);
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-border py-1.5 pl-3 pr-1.5">
      <SquireAvatar kind={avatar} animated={animated} state={mascotState} />
      <h2 className="shrink-0 text-sm font-semibold">{name}</h2>
      <span className="sr-only">{statusLabel}</span>
      <span
        title={context.title}
        className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${toneClasses('neutral').soft}`}
      >
        {context.urgent && (
          <>
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneClasses('critical').solid}`}
            />
            <span className="sr-only">High urgency:</span>
          </>
        )}
        <span className="truncate">{context.label}</span>
      </span>
      <div className="ml-auto flex shrink-0 items-center">
        <button type="button" onClick={onNewChat} aria-label="New chat" title="New chat" className={iconButton}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        {hasHistory && (
          <button
            type="button"
            onClick={onToggleHistory}
            aria-pressed={showHistory}
            aria-label="Saved conversations"
            title="Saved conversations"
            className={`${iconButton} aria-pressed:bg-accent aria-pressed:text-foreground`}
          >
            <History className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        {hasMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="More actions" title="More actions" className={iconButton}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onToggleExpanded && (
                <DropdownMenuItem onSelect={onToggleExpanded}>
                  {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                  {expanded ? 'Narrow chat' : 'Expand chat'}
                </DropdownMenuItem>
              )}
              {dock.available && (
                <DropdownMenuItem onSelect={dock.toggle}>
                  {dock.docked ? (
                    <PictureInPicture2 aria-hidden="true" />
                  ) : (
                    <PanelRight aria-hidden="true" />
                  )}
                  {dock.docked ? `Float ${name} over the page` : `Dock ${name} beside the page`}
                </DropdownMenuItem>
              )}
              {onSwitchSide && (
                <DropdownMenuItem onSelect={onSwitchSide}>
                  <ArrowLeftRight aria-hidden="true" />
                  Move {name} to the {side === 'right' ? 'left' : 'right'} side
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${name}`}
          title="Close (Esc)"
          className={iconButton}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
