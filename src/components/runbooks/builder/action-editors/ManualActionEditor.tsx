'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';

interface ManualActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

export default function ManualActionEditor({
  config,
  editorId = 'manual',
  readOnly = false,
  onChange,
}: ManualActionEditorProps) {
  const instructions = String(config.instructions ?? '');

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor={`manual-instructions-${editorId}`}>Manual Task Instructions</Label>
          <span className="text-xs text-muted-foreground">Shown to on-call responder</span>
        </div>
        <div className="mt-1.5">
          <Textarea
            id={`manual-instructions-${editorId}`}
            aria-label="Manual instructions"
            placeholder="Describe the physical or manual verification task the responder must perform before marking this step complete..."
            value={instructions}
            disabled={readOnly}
            onChange={e => onChange({ ...config, instructions: e.target.value })}
            className="text-xs min-h-24"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Manual steps pause execution until an assigned responder acknowledges and marks completion in the web console or incident war room.
      </p>
    </div>
  );
}
