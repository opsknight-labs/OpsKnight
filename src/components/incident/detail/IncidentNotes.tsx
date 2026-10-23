'use client';

import { useState, useRef } from 'react';
import NoteCard from '../NoteCard';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  MessageSquare,
  Send,
  Lock,
  Loader2,
  Bold,
  Italic,
  Code,
  Link2,
  List,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';
import { loadOlderIncidentNotes } from './actions';
import { NoteMarkdown } from './NoteMarkdown';
import { cn } from '@/lib/utils';

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
  onAddNote: (formData: FormData) => Promise<void> | void;
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
  const [prevNotes, setPrevNotes] = useState<Note[]>(notes);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [noteContent, setNoteContent] = useState('');
  const [isPreview, setIsPreview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (notes !== prevNotes) {
    setPrevNotes(notes);
    setLoadedNotes(notes);
  }

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

  const insertTextAtCursor = (prefix: string, suffix: string, defaultPlaceholder = '') => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setNoteContent(prev => prev + prefix + defaultPlaceholder + suffix);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;
    const selectedText = currentVal.substring(start, end);

    const replacement = selectedText
      ? `${prefix}${selectedText}${suffix}`
      : `${prefix}${defaultPlaceholder}${suffix}`;

    const nextVal = currentVal.substring(0, start) + replacement + currentVal.substring(end);
    setNoteContent(nextVal);

    requestAnimationFrame(() => {
      textarea.focus();
      if (selectedText) {
        textarea.setSelectionRange(start, start + replacement.length);
      } else {
        const cursorTarget = start + prefix.length;
        textarea.setSelectionRange(cursorTarget, cursorTarget + defaultPlaceholder.length);
      }
    });
  };

  const applyFormat = (type: 'bold' | 'italic' | 'code' | 'link' | 'list') => {
    if (isPreview) setIsPreview(false);

    switch (type) {
      case 'bold':
        insertTextAtCursor('**', '**', 'bold text');
        break;
      case 'italic':
        insertTextAtCursor('*', '*', 'italic text');
        break;
      case 'code':
        insertTextAtCursor('`', '`', 'code');
        break;
      case 'link':
        insertTextAtCursor('[', '](https://example.com)', 'link title');
        break;
      case 'list': {
        const textarea = textareaRef.current;
        if (!textarea) {
          setNoteContent(prev => (prev ? `${prev}\n- List item` : '- List item'));
          return;
        }
        const start = textarea.selectionStart;
        const currentVal = textarea.value;
        const before = currentVal.substring(0, start);
        const needsNewline = before.length > 0 && !before.endsWith('\n');
        insertTextAtCursor(needsNewline ? '\n- ' : '- ', '', 'List item');
        break;
      }
    }
  };

  const handleSubmit = async (formData: FormData) => {
    const submittedText = noteContent.trim();
    if (!submittedText || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      await onAddNote(formData);
      // Preserve newer typing: only clear the exact submitted text snapshot
      setNoteContent(prev => {
        if (prev.trim() === submittedText) return '';
        if (prev.startsWith(submittedText)) return prev.slice(submittedText.length).trimStart();
        return prev;
      });
      setIsPreview(false);
    } catch (err) {
      console.error('Failed to post incident note', err);
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to post note. Your draft has been preserved.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Add Note Form */}
      {canManage ? (
        <div className="group relative">
          <form action={handleSubmit} className="space-y-2">
            <div className="relative rounded-xl border border-border/80 bg-card shadow-2xs transition-all focus-within:shadow-md focus-within:border-primary/50 overflow-hidden">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-1 bg-muted/30 px-2 py-1.5 border-b border-border/60">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => applyFormat('bold')}
                    title="Bold (**text**)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Format bold"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('italic')}
                    title="Italic (*text*)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Format italic"
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('code')}
                    title="Inline code (`code`)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Format inline code"
                  >
                    <Code className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('link')}
                    title="Hyperlink ([text](url))"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Insert hyperlink"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('list')}
                    title="Bullet list (- item)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label="Insert bullet list"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* Write vs Preview Toggle */}
                  <button
                    type="button"
                    onClick={() => setIsPreview(!isPreview)}
                    className={cn(
                      'px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer',
                      isPreview
                        ? 'bg-primary/10 text-primary border border-primary/20 font-semibold'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    )}
                    aria-label={isPreview ? 'Switch to Write mode' : 'Switch to Preview mode'}
                  >
                    {isPreview ? (
                      <>
                        <EyeOff className="h-3 w-3" />
                        <span>Write</span>
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3" />
                        <span>Preview</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Submission Error Banner */}
              {submitError && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-600 dark:text-rose-400">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{submitError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubmitError(null)}
                    className="text-[10px] underline hover:no-underline font-medium cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Input Area or Live Preview */}
              {isPreview ? (
                <div className="p-3.5 min-h-[90px] max-h-64 overflow-y-auto bg-card text-foreground">
                  {noteContent.trim() ? (
                    <NoteMarkdown content={noteContent} />
                  ) : (
                    <span className="text-xs italic text-muted-foreground">
                      Nothing to preview. Type a note or format text above.
                    </span>
                  )}
                  {/* Hidden textarea so standard FormData capture continues to function */}
                  <textarea
                    name="content"
                    value={noteContent}
                    readOnly
                    className="sr-only"
                    tabIndex={-1}
                  />
                </div>
              ) : (
                <Textarea
                  ref={textareaRef}
                  name="content"
                  value={noteContent}
                  onChange={e => setNoteContent(e.target.value)}
                  placeholder="Type a note (Markdown supported: **bold**, *italic*, `code`, [link](url))..."
                  required
                  rows={3}
                  className="resize-none border-0 bg-transparent focus-visible:ring-0 p-3.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground"
                />
              )}

              {/* Footer Row */}
              <div className="flex items-center justify-between bg-muted/20 px-3 py-2 border-t border-border/60">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>Markdown formatting supported</span>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting || !noteContent.trim()}
                  className="h-7 rounded-lg px-3 gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Posting...
                    </>
                  ) : (
                    <>
                      <Send className="h-3 w-3" />
                      Post
                    </>
                  )}
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
            <p className="text-xs font-medium text-foreground">No notes yet</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {canManage
                ? 'Add the first response note to keep responders aligned.'
                : 'No response notes have been added to this incident yet.'}
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

        {/* Load More Button */}
        {hasMoreNotes && (
          <div className="pt-2 text-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadOlderNotes}
              disabled={isLoadingMore}
              className="text-xs"
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Loading older notes...
                </>
              ) : (
                `Load older notes (${loadedNotes.length} of ${totalNotesCount})`
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
