import { Archive, CheckCircle2, FilePen, FileText, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@/lib/design/status-palette';

type Meta = { label: string; tone: StatusTone | null; icon: LucideIcon };

/** Postmortem lifecycle → label/tone. Published is the only "done" (emerald) state. */
export function postmortemStatusMeta(status: string | null | undefined): Meta {
  switch ((status ?? '').toUpperCase()) {
    case 'PUBLISHED':
      return { label: 'Published', tone: 'ok', icon: CheckCircle2 };
    case 'ARCHIVED':
      return { label: 'Archived', tone: null, icon: Archive };
    case 'DRAFT':
      return { label: 'Draft', tone: null, icon: FilePen };
    default: {
      const raw = (status ?? '').toLowerCase().replace(/_/g, ' ');
      return {
        label: raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Unknown',
        tone: 'info',
        icon: FileText,
      };
    }
  }
}
