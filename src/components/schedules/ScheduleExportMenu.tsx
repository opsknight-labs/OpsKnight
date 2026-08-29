'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { useToast } from '@/hooks/use-product-notification';
import { Calendar, Download, Link, Check, ExternalLink } from 'lucide-react';

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
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const icsUrl = `/api/schedules/${scheduleId}/calendar.ics`;

  const handleCopyLink = async () => {
    try {
      const fullUrl = `${window.location.origin}${icsUrl}`;
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      showToast('iCal subscription link copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy link to clipboard', 'error');
    }
  };

  const handleDownload = () => {
    window.open(icsUrl, '_blank');
  };

  const handleGoogleCalendar = () => {
    const fullUrl = `${window.location.origin}${icsUrl}`;
    const webcalUrl = fullUrl.replace(/^https?:\/\//, 'webcal://');
    window.open(
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`,
      '_blank'
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={
            className ||
            'h-8.5 gap-1.5 border-border/80 bg-background/80 text-xs font-medium backdrop-blur-sm hover:bg-muted/80 shadow-2xs'
          }
        >
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <span>Export / Sync</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 text-xs">
        <DropdownMenuItem onClick={handleDownload} className="cursor-pointer gap-2 py-2">
          <Download className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <p className="font-medium">Download .ics File</p>
            <p className="text-[10px] text-muted-foreground">
              Import into Apple, Outlook or Google
            </p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer gap-2 py-2">
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Link className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <div>
            <p className="font-medium">Copy iCal Feed URL</p>
            <p className="text-[10px] text-muted-foreground">
              Live auto-updating subscription feed
            </p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handleGoogleCalendar} className="cursor-pointer gap-2 py-2">
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <p className="font-medium">Subscribe in Google Calendar</p>
            <p className="text-[10px] text-muted-foreground">Add directly via webcal</p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
