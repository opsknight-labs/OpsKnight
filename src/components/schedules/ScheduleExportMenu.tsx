'use client';

import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Calendar, Download } from 'lucide-react';

type ScheduleExportMenuProps = {
  scheduleId: string;
  scheduleName?: string;
  className?: string;
};

export default function ScheduleExportMenu({
  scheduleId,
  scheduleName,
  className,
}: ScheduleExportMenuProps) {
  // The .ics endpoint is session-authenticated, so calendar apps cannot poll it;
  // only offer a one-off download until a tokenised feed exists.
  const icsUrl = `/api/schedules/${scheduleId}/calendar.ics`;

  const handleDownload = () => {
    window.open(icsUrl, '_blank');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Export ${scheduleName ?? 'schedule'} coverage`}
          variant="outline"
          size="sm"
          className={
            className ||
            'h-8.5 gap-1.5 border-border/80 bg-background/80 text-xs font-medium backdrop-blur-sm hover:bg-muted/80 shadow-2xs'
          }
        >
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <span>Export</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleDownload}>
          <Download />
          <div>
            <p>Download .ics File</p>
            <p className="text-xs text-muted-foreground">Import into Apple, Outlook or Google</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
