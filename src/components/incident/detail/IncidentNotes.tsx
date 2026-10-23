'use client';

import { useState, useEffect } from 'react';
import NoteCard from '../NoteCard';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { MessageSquare, Send, Lock, Loader2 } from 'lucide-react';
import { loadOlderIncidentNotes } from './actions';

type Note = {
  id: string;
  content: string;
  user: {
    id?: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  createdAt: Date;
};

type IncidentNotesProps = {
  incidentId?: string;
  notes: Note[];
  canManage: boolean;
  onAddNote: (formData: FormData) => void;
  totalNotesCount?: number;
};

export default function IncidentNotes({
  incidentId,
  notes,
  canManage,
  onAddNote,
  totalNotesCount,
}: IncidentNotesProps) {
  const [loadedNotes, setLoadedNotes] = useState<Note[]>(notes);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  useEffect(() => {
    setLoadedNotes(notes);
  }, [notes]);

  const hasMoreNotes = incidentId && totalNotesCount ? totalNotesCount > loadedNotes.length : false;

  const handleLoadOlderNotes = async () => {
    if (!incidentId || isLoadingMore || loadedNotes.length === 0) return;
    setIsLoadingMore(true);
    try {
      const oldestNote = loadedNotes[loadedNotes.length - 1];
      const older = await loadOlderIncidentNotes(
        incidentId,
        new Date(oldestNote.createdAt).toISOString(),
        oldestNote.id
      );
      if (older.length > 0) {
        setLoadedNotes(prev => [
          ...prev,
          ...older.map(n => ({ ...n, createdAt: new Date(n.createdAt) })),
        ]);
      }
    } catch (err) {
      console.error('Failed to load older notes', err);
    } finally {
      setIsLoadingMore(false);
    }
  };
  return (
    <div className="space-y-4">
      {/* Add Note Form */}
      {canManage ? (
        <div className="group relative">
          <form action={onAddNote} className="space-y-2">
            <div className="relative rounded-xl border border-border/80 bg-card shadow-2xs transition-all focus-within:shadow-md focus-within:border-primary/50 overflow-hidden">
              <Textarea
                name="content"
                placeholder="Type a note (Markdown supported)..."
                required
                rows={3}
                className="resize-none border-0 bg-transparent focus-visible:ring-0 p-3.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between bg-muted/20 px-3 py-2 border-t border-border/60">
                <div className="flex gap-2">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    **bold** *italic* `code`
                  </span>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  className="h-7 rounded-lg px-3 gap-1.5 text-xs font-semibold shadow-2xs"
                >
                  <Send className="h-3 w-3" />
                  Post
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-3 bg-muted/20 border border-border/70 rounded-xl">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">Read Only</p>
            <p className="text-[11px] text-muted-foreground">
              Only responders can add notes to this incident.
            </p>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="space-y-3">
        {loadedNotes.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-border/80 rounded-xl bg-muted/10">
            <MessageSquare className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
            <h3 className="text-xs font-semibold text-foreground">No notes yet</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Start the conversation by adding a note above.
            </p>
          </div>
        ) : (
          loadedNotes.map(note => (
            <NoteCard
              key={note.id}
              content={note.content}
              userId={note.user?.id}
              userName={note.user?.name ?? 'Deleted user'}
              userAvatar={note.user?.avatarUrl}
              userGender={note.user?.gender}
              createdAt={note.createdAt}
              isResolution={note.content.startsWith('Resolution:')}
            />
          ))
        )}

        {hasMoreNotes && (
          <div className="mt-4 flex flex-col items-center justify-center p-3 border border-border/70 rounded-xl bg-muted/20 text-xs text-muted-foreground gap-2">
            <span>
              Showing {loadedNotes.length} of {totalNotesCount} notes
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadOlderNotes}
              disabled={isLoadingMore}
              className="h-8 gap-1.5"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading older notes...</span>
                </>
              ) : (
                <span>Load older notes</span>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
