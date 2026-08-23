'use client';

import React, { useState } from 'react';
import { Calendar, ChevronDown, Check } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function DateRangePicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);

  const currentWindow = Number(searchParams?.get('window') || 7);

  const ranges = [
    { label: 'Last 24 Hours', value: 1 },
    { label: 'Last 3 Days', value: 3 },
    { label: 'Last 7 Days', value: 7 },
    { label: 'Last 14 Days', value: 14 },
    { label: 'Last 30 Days', value: 30 },
    { label: 'Last Quarter (90d)', value: 90 },
  ];

  const handleSelect = (value: number) => {
    const params = new URLSearchParams(searchParams?.toString());
    params.set('window', value.toString());
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  };

  const currentLabel =
    ranges.find(r => r.value === currentWindow)?.label || `Last ${currentWindow} Days`;

  return (
    <div className="relative relative-date-picker">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select date range"
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-background border border-border hover:bg-secondary/50 rounded-lg transition-all shadow-sm min-w-[160px] justify-between"
      >
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span>{currentLabel}</span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            role="listbox"
            aria-label="Date range options"
            className="absolute top-[calc(100%+4px)] right-0 z-50 w-56 bg-popover border border-border rounded-lg shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="p-1">
              {ranges.map(range => (
                <button
                  key={range.value}
                  type="button"
                  role="option"
                  aria-selected={currentWindow === range.value}
                  onClick={() => handleSelect(range.value)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md flex items-center justify-between transition-colors ${currentWindow === range.value ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-secondary text-popover-foreground'}`}
                >
                  <span>{range.label}</span>
                  {currentWindow === range.value && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
            <div className="border-t border-border p-2 bg-muted/20">
              <div className="text-[10px] text-muted-foreground text-center">
                Custom dates coming soon
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
