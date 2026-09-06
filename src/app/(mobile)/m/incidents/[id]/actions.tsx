'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import MobileBottomSheet from '@/components/mobile/MobileBottomSheet';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import {
  updateIncidentStatus,
  addNote,
  updateIncidentUrgency,
  reassignIncident,
  resolveIncidentWithNote,
} from '@/app/(app)/incidents/actions';
import { snoozeIncidentWithDuration } from '@/app/(app)/incidents/snooze-actions';

type User = { id: string; name: string; email: string };
type Team = { id: string; name: string };

type SheetMode = 'more' | 'resolve' | 'note' | 'snooze' | 'reassign' | null;

const RESOLUTION_MIN = 10;

export default function MobileIncidentActions({
  incidentId,
  status,
  urgency,
  assigneeId,
  currentUserId,
  users,
  teams,
}: {
  incidentId: string;
  status: string;
  urgency: string;
  assigneeId: string | null;
  currentUserId: string | null;
  users: User[];
  teams: Team[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [sheetMode, setSheetMode] = useState<SheetMode>(null);
  const [note, setNote] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const sheetTitle = useMemo(() => {
    switch (sheetMode) {
      case 'resolve':
        return 'Resolve incident';
      case 'note':
        return 'Add note';
      case 'snooze':
        return 'Snooze incident';
      case 'reassign':
        return 'Reassign incident';
      case 'more':
      default:
        return 'More actions';
    }
  }, [sheetMode]);

  const openSheet = (mode: SheetMode) => {
    setSheetMode(mode);
    setErrorMessage('');
  };

  const closeSheet = () => {
    setSheetMode(null);
    setErrorMessage('');
  };

  const handleFailure = (message: string, error: unknown) => {
    setErrorMessage(message);
    logger.error('mobile.incidentAction.failed', { component: 'MobileIncidentActions', error });
  };

  const handleAction = async (action: 'ACKNOWLEDGE' | 'RESOLVE' | 'OPEN') => {
    if (loading) return;
    setLoading(true);
    setErrorMessage('');
    try {
      if (action === 'ACKNOWLEDGE') {
        await updateIncidentStatus(incidentId, 'ACKNOWLEDGED');
      } else if (action === 'RESOLVE') {
        await updateIncidentStatus(incidentId, 'RESOLVED');
      } else if (action === 'OPEN') {
        await updateIncidentStatus(incidentId, 'OPEN');
      }
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure('Failed to update incident status', error);
    } finally {
      setLoading(false);
    }
  };

  const handleResolve = async () => {
    if (loading) return;
    const trimmed = resolutionNote.trim();
    if (trimmed.length < RESOLUTION_MIN) {
      setErrorMessage(`Resolution note must be at least ${RESOLUTION_MIN} characters.`);
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await resolveIncidentWithNote(incidentId, trimmed);
      setResolutionNote('');
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure(error instanceof Error ? error.message : 'Failed to resolve incident', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSnooze = async (hours: number) => {
    if (loading) return;
    setLoading(true);
    setErrorMessage('');
    try {
      await snoozeIncidentWithDuration(incidentId, hours * 60, `Snoozed via mobile for ${hours}h`);
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure('Failed to snooze incident', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUrgencyToggle = async () => {
    if (loading) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const newUrgency = urgency === 'HIGH' ? 'MEDIUM' : urgency === 'MEDIUM' ? 'LOW' : 'HIGH';
      await updateIncidentUrgency(incidentId, newUrgency);
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure('Failed to update urgency', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTakeOwnership = async () => {
    if (loading || !currentUserId) return;
    setLoading(true);
    setErrorMessage('');
    try {
      await reassignIncident(incidentId, currentUserId);
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure('Failed to assign incident', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!note.trim() || loading) {
      setErrorMessage('Add a note before saving.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      await addNote(incidentId, note.trim());
      setNote('');
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure('Failed to add note', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReassign = async (userId: string, teamId?: string) => {
    if (loading) return;
    setLoading(true);
    setErrorMessage('');
    try {
      await reassignIncident(incidentId, userId, teamId);
      closeSheet();
      router.refresh();
    } catch (error) {
      handleFailure('Failed to reassign incident', error);
    } finally {
      setLoading(false);
    }
  };

  const showBack = sheetMode !== null && sheetMode !== 'more' && sheetMode !== 'resolve';

  const snapPoints = (
    sheetMode === 'resolve' || sheetMode === 'reassign' || sheetMode === 'note'
      ? ['full']
      : ['content']
  ) satisfies Array<'content' | 'full' | 'half'>;

  const actionBase =
    'flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';

  const sheetButtonBase =
    'rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-sm font-semibold text-[color:var(--text-secondary)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className="flex flex-col gap-3">
      <div className={cn('flex gap-2', status === 'OPEN' ? 'flex-col' : 'flex-row')}>
        {status === 'OPEN' && (
          <button
            onClick={() => handleAction('ACKNOWLEDGE')}
            disabled={loading}
            className={cn(
              actionBase,
              'w-full bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
            )}
          >
            {loading ? '...' : 'Acknowledge'}
          </button>
        )}
        <div className="flex gap-2 flex-1">
          {status !== 'RESOLVED' && (
            <button
              onClick={() => openSheet('resolve')}
              disabled={loading}
              className={cn(actionBase, 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm')}
            >
              Resolve
            </button>
          )}
          <button
            onClick={() => openSheet('more')}
            className={cn(
              actionBase,
              'border border-[color:var(--border)] bg-[color:var(--bg-surface)] text-[color:var(--text-secondary)] hover:bg-[color:var(--bg-secondary)] shadow-sm'
            )}
          >
            More
          </button>
        </div>
      </div>

      {errorMessage && sheetMode === null && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      <MobileBottomSheet
        isOpen={sheetMode !== null}
        onClose={closeSheet}
        title={sheetTitle}
        snapPoints={snapPoints}
      >
        {showBack && (
          <button
            className="mb-3 inline-flex items-center text-xs font-semibold text-primary"
            onClick={() => openSheet('more')}
          >
            Back to actions
          </button>
        )}

        {errorMessage && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {sheetMode === 'more' && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => openSheet('note')} className={sheetButtonBase}>
              Add note
            </button>
            <button onClick={handleUrgencyToggle} disabled={loading} className={sheetButtonBase}>
              {urgency === 'LOW' ? 'Raise urgency' : 'Lower urgency'}
            </button>
            {(!assigneeId || assigneeId !== currentUserId) && (
              <button onClick={handleTakeOwnership} disabled={loading} className={sheetButtonBase}>
                Take ownership
              </button>
            )}
            {status !== 'RESOLVED' && status !== 'SNOOZED' && (
              <button onClick={() => openSheet('snooze')} className={sheetButtonBase}>
                Snooze
              </button>
            )}
            {status === 'SNOOZED' && (
              <button
                onClick={() => handleAction('OPEN')}
                disabled={loading}
                className={sheetButtonBase}
              >
                Unsnooze
              </button>
            )}
            <button onClick={() => openSheet('reassign')} className={sheetButtonBase}>
              Reassign
            </button>
          </div>
        )}

        {sheetMode === 'resolve' && (
          <div className="flex flex-col gap-3">
            <textarea
              placeholder="Describe root cause, fix applied, or summary... (min 10 chars)"
              value={resolutionNote}
              onChange={e => setResolutionNote(e.target.value)}
              className="min-h-[140px] w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="text-[11px] font-medium text-[color:var(--text-muted)]">
              {resolutionNote.length}/1000 characters (min {RESOLUTION_MIN})
            </div>
            <button
              onClick={handleResolve}
              disabled={loading || resolutionNote.trim().length < RESOLUTION_MIN}
              className={cn(
                'rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60'
              )}
            >
              {loading ? 'Resolving...' : 'Resolve incident'}
            </button>
          </div>
        )}

        {sheetMode === 'note' && (
          <div className="flex flex-col gap-3">
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add a note..."
              className="min-h-[140px] w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex gap-2">
              <button
                onClick={() => openSheet('more')}
                className="flex-1 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-secondary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleAddNote}
                disabled={loading || !note.trim()}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save note
              </button>
            </div>
          </div>
        )}

        {sheetMode === 'snooze' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Snooze for
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[1, 4, 24].map(hours => (
                <button
                  key={hours}
                  onClick={() => handleSnooze(hours)}
                  disabled={loading}
                  className={sheetButtonBase}
                >
                  {hours}h
                </button>
              ))}
            </div>
          </div>
        )}

        {sheetMode === 'reassign' && (
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Assign to user
            </label>
            <select
              onChange={e => e.target.value && handleReassign(e.target.value)}
              disabled={loading}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              defaultValue=""
            >
              <option value="">Select a user...</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {user.name || user.email}
                </option>
              ))}
            </select>

            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Assign to team
            </label>
            <select
              onChange={e => e.target.value && handleReassign('', e.target.value)}
              disabled={loading}
              className="w-full rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              defaultValue=""
            >
              <option value="">Select a team...</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>

            <button
              onClick={() => handleReassign('', '')}
              disabled={loading}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-sm font-semibold text-[color:var(--text-secondary)] transition hover:bg-[color:var(--bg-secondary)]"
            >
              Unassign
            </button>
          </div>
        )}
      </MobileBottomSheet>
    </div>
  );
}
