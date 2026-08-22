'use client';

import NoteCard from '../NoteCard';
import { Button } from '@/components/ui/shadcn/button';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { MessageSquare, Send, Lock, User } from 'lucide-react';

type Note = {
  id: string;
  content: string;
  user: {
    id?: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  };
  createdAt: Date;
};

type IncidentNotesProps = {
  notes: Note[];
  canManage: boolean;
  onAddNote: (formData: FormData) => void;
};

export default function IncidentNotes({ notes, canManage, onAddNote }: IncidentNotesProps) {
  return (
    <div className="space-y-6">
      {/* Add Note Form */}
      {canManage ? (
        <div className="group relative">
          <form action={onAddNote} className="space-y-3">
            <div className="relative rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow focus-within:shadow-md focus-within:border-primary/50 overflow-hidden">
              <Textarea
                name="content"
                placeholder="Type a note (Markdown supported)..."
                required
                rows={3}
                className="resize-none border-0 bg-transparent focus-visible:ring-0 p-4 text-sm"
              />
              <div className="flex items-center justify-between bg-slate-50/50 px-3 py-2 border-t border-slate-100">
                <div className="flex gap-2">
                  <span className="text-[10px] text-slate-400 font-medium">
                    **bold** *italic* `code`
                  </span>
                </div>
                <Button type="submit" size="sm" className="h-8 rounded-lg px-4 gap-2">
                  <Send className="h-3.5 w-3.5" />
                  Post
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
            <Lock className="h-4 w-4 text-slate-500" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-700">Read Only</p>
            <p className="text-xs text-slate-500">
              Only responders can add notes to this incident.
            </p>
          </div>
        </div>
      )}

      {/* Notes List */}
      <div className="space-y-4">
        {notes.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No notes yet</h3>
            <p className="text-sm text-muted-foreground">
              Start the conversation by adding a note above.
            </p>
          </div>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              content={note.content}
              userId={note.user.id}
              userName={note.user.name}
              userAvatar={note.user.avatarUrl}
              userGender={note.user.gender}
              createdAt={note.createdAt}
              isResolution={note.content.startsWith('Resolution:')}
            />
          ))
        )}
      </div>
    </div>
  );
}
