'use client';
import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

type Option = { value: string; label: string };
export function SearchableRunbookSelect({ kind, label, name, value, onChange, required = false }: {
  kind: 'service' | 'runbook' | 'agent' | 'target'; label: string; name?: string; value?: string; onChange?: (value: string) => void; required?: boolean;
}) {
  const id = useId(); const [search, setSearch] = useState(''); const [options, setOptions] = useState<Option[]>([]);
  const [selection, setSelection] = useState(value ?? ''); const [error, setError] = useState(false); const [loading, setLoading] = useState(false);
  const selected = value === undefined ? selection : value === 'all' ? '' : value;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(false);
      try {
        const params = new URLSearchParams({ kind, q: search }); if (selected) params.set('selected', selected);
        const response = await fetch(`/api/runbooks/options?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Search failed');
        const data: { options: Option[] } = await response.json(); setOptions(data.options);
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, search, selected]);
  return <div className="space-y-1.5 min-w-0">
    <Label htmlFor={id}>{label}</Label>
    <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search by name…" value={search} onChange={event => setSearch(event.target.value)} className="h-8 text-xs" />
    <select id={id} name={name} value={selected} required={required} onChange={event => { setSelection(event.target.value); onChange?.(event.target.value || 'all'); }} className="h-9 w-full rounded-md border bg-background px-2 text-xs">
      <option value="">{required ? 'Choose a target' : 'All'}</option>
      {selected && !options.some(option => option.value === selected) && <option value={selected}>{selected}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <p role="status" className="text-xs text-muted-foreground">{error ? 'Search unavailable. Try again.' : loading ? 'Searching…' : 'Search the full catalog; up to 30 matches.'}</p>
  </div>;
}
