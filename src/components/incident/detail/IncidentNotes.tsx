'use client';

import { useState, useRef, type DragEvent, type ClipboardEvent } from 'react';
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
  Image as ImageIcon,
  Paperclip,
  Eye,
  EyeOff,
  UploadCloud,
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
  onAddNote: (formData: FormData) => void;
  totalNotesCount?: number;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const insertTextAtCursor = (prefix: string, suffix = '', defaultText = '') => {
    setIsPreview(false);
    const textarea = textareaRef.current;
    if (!textarea) {
      setNoteContent(prev => `${prev}${prefix}${defaultText}${suffix}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || defaultText;
    const replacement = `${prefix}${selected}${suffix}`;
    const newContent = textarea.value.slice(0, start) + replacement + textarea.value.slice(end);

    setNoteContent(newContent);

    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + prefix.length + selected.length;
      textarea.setSelectionRange(
        selected === defaultText ? start + prefix.length : newCursorPos,
        newCursorPos
      );
    }, 0);
  };

  const applyFormat = (type: 'bold' | 'italic' | 'code' | 'link' | 'list') => {
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
        insertTextAtCursor('[', '](https://example.com)', 'Link title');
        break;
      case 'list':
        insertTextAtCursor('\n- ', '', 'List item');
        break;
    }
  };

  const handleUploadFile = async (file: File, isImageHint = false) => {
    if (!file) return;
    setUploadError(null);
    if (file.size > 15 * 1024 * 1024) {
      setUploadError(`File "${file.name}" exceeds the 15MB limit.`);
      return;
    }

    setIsUploading(true);
    setUploadStatus(`Uploading ${file.name}...`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/uploads', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Upload failed');
      }

      const data = await res.json();
      const isImg = data.isImage || isImageHint;

      const markdownSnippet = isImg
        ? `\n![${data.filename}](${data.url})\n`
        : `\n[📎 ${data.filename} (${formatFileSize(data.size)})](${data.url})\n`;

      insertTextAtCursor('', '', markdownSnippet);
    } catch (err) {
      console.error('File upload failed', err);
      setUploadError(err instanceof Error ? err.message : 'File upload failed');
    } finally {
      setIsUploading(false);
      setUploadStatus(null);
    }
  };

  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
    isImageHint = false
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const fileList = Array.from(files);
    for (const file of fileList) {
      await handleUploadFile(file, isImageHint);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (!canManage) return;

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      await handleUploadFile(file, isImage);
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        e.preventDefault();
        await handleUploadFile(file, true);
      }
    }
  };

  const handleSubmit = (formData: FormData) => {
    onAddNote(formData);
    setNoteContent('');
    setIsPreview(false);
  };

  return (
    <div className="space-y-4">
      {/* Hidden File Inputs */}
      <input
        type="file"
        ref={imageInputRef}
        accept="image/*"
        aria-label="Upload picture attachment"
        className="hidden"
        onChange={e => handleFileInputChange(e, true)}
      />
      <input
        type="file"
        ref={fileInputRef}
        aria-label="Upload file attachment"
        className="hidden"
        onChange={e => handleFileInputChange(e, false)}
      />

      {/* Add Note Form */}
      {canManage ? (
        <div
          className="group relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <form action={handleSubmit} className="space-y-2">
            <div
              className={cn(
                'relative rounded-xl border border-border/80 bg-card shadow-2xs transition-all focus-within:shadow-md focus-within:border-primary/50 overflow-hidden',
                isDragging && 'border-primary ring-2 ring-primary/20 bg-primary/5'
              )}
            >
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-1 bg-muted/30 px-2 py-1.5 border-b border-border/60">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => applyFormat('bold')}
                    title="Bold (**text**)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Format bold"
                  >
                    <Bold className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('italic')}
                    title="Italic (*text*)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Format italic"
                  >
                    <Italic className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('code')}
                    title="Inline code (`code`)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Format inline code"
                  >
                    <Code className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('link')}
                    title="Hyperlink ([text](url))"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Insert hyperlink"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormat('list')}
                    title="Bullet list (- item)"
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Insert bullet list"
                  >
                    <List className="h-3.5 w-3.5" />
                  </button>

                  <div className="h-4 w-px bg-border/80 mx-1" />

                  {/* Picture Upload Button */}
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    title="Upload picture / image"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    aria-label="Upload picture"
                  >
                    <ImageIcon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] hidden sm:inline">Picture</span>
                  </button>

                  {/* File Attachment Upload Button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload file attachment"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    aria-label="Upload file attachment"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] hidden sm:inline">File</span>
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

              {/* Upload Status Banner */}
              {isUploading && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border-b border-primary/20 text-xs text-primary animate-pulse">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{uploadStatus || 'Uploading file...'}</span>
                </div>
              )}

              {/* Upload Error Banner */}
              {uploadError && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-rose-500/10 border-b border-rose-500/20 text-xs text-rose-600 dark:text-rose-400">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUploadError(null)}
                    className="text-[10px] underline hover:no-underline font-medium"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Dragging overlay notification */}
              {isDragging && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card/95 backdrop-blur-xs border-2 border-dashed border-primary text-primary">
                  <UploadCloud className="h-8 w-8 animate-bounce mb-1" />
                  <span className="text-xs font-semibold">Drop image or file to upload</span>
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
                  {/* Keep hidden textarea with content so form submit still works if submitted from preview */}
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
                  onPaste={handlePaste}
                  placeholder="Type a note (Markdown supported: **bold**, *italic*, `code`, [link](url), pictures & files)..."
                  required
                  rows={3}
                  className="resize-none border-0 bg-transparent focus-visible:ring-0 p-3.5 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground"
                />
              )}

              {/* Footer Row */}
              <div className="flex items-center justify-between bg-muted/20 px-3 py-2 border-t border-border/60">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>Markdown &amp; drag-and-drop supported</span>
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isUploading || !noteContent.trim()}
                  className="h-7 rounded-lg px-3 gap-1.5 text-xs font-semibold shadow-2xs cursor-pointer"
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
              className="h-8 gap-1.5 cursor-pointer"
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
