'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { INTEGRATION_TYPES, IntegrationType, IntegrationCategory } from './integration-types';
import { createIntegration } from '@/app/(app)/services/actions';
import { useToast } from '@/hooks/use-product-notification';
import { Loader2, Plus, Info, Search } from 'lucide-react';

interface AddIntegrationGridProps {
  serviceId: string;
}

export default function AddIntegrationGrid({ serviceId }: AddIntegrationGridProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<IntegrationType | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<IntegrationCategory | 'All'>('All');
  const { showToast } = useToast();

  const handleTypeClick = (type: IntegrationType) => {
    setSelectedType(type);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setTimeout(() => setSelectedType(null), 300);
  };

  const categories: (IntegrationCategory | 'All')[] = [
    'All',
    'Cloud & Infrastructure',
    'Monitoring & APM',
    'CI/CD & Version Control',
    'Uptime & Status',
    'Incident Management',
    'Other',
  ];

  const filteredIntegrations = INTEGRATION_TYPES.filter(type => {
    const matchesSearch =
      type.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      type.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || type.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleSubmit = async (formData: FormData) => {
    setLoading(true);
    try {
      await createIntegration(formData);
      showToast('Integration created successfully', 'success');
      router.refresh();
      handleClose();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Failed to create integration';
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const selectedTypeInfo = selectedType
    ? INTEGRATION_TYPES.find(t => t.value === selectedType)
    : null;

  return (
    <div className="space-y-3.5">
      {/* Compact Header & Search Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2">
            <span>Add Integration</span>
            <span className="text-[11px] font-normal text-slate-400">
              ({filteredIntegrations.length} available)
            </span>
          </h2>
          <p className="text-xs text-slate-500">
            Connect external monitoring, alerting, or CI/CD providers to send events into this
            service.
          </p>
        </div>
        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-xs bg-slate-50/70 border-slate-200 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map(category => (
          <button
            key={category}
            type="button"
            onClick={() => setSelectedCategory(category)}
            className={`
              px-2.5 py-1 text-[11px] font-medium rounded-md transition-all
              ${
                selectedCategory === category
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100/80 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
              }
            `}
          >
            {category}
          </button>
        ))}
      </div>

      {filteredIntegrations.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
          <Search className="mx-auto h-6 w-6 text-slate-300 mb-2" />
          <h3 className="text-xs font-semibold text-slate-800">No integrations found</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            No providers match &ldquo;{searchQuery}&rdquo; in category &ldquo;{selectedCategory}
            &rdquo;.
          </p>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('All');
            }}
            className="mt-1 text-xs h-7"
          >
            Clear all filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {filteredIntegrations.map(type => (
            <div
              key={type.value}
              role="button"
              tabIndex={0}
              onClick={() => handleTypeClick(type.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleTypeClick(type.value);
                }
              }}
              className="group relative flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50/80 hover:border-primary/40 hover:shadow-xs cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <div
                className="w-8 h-8 rounded-md shrink-0 flex items-center justify-center shadow-xs ring-1 ring-black/5 group-hover:scale-105 transition-transform [&_svg]:h-4 [&_svg]:w-4"
                style={{ backgroundColor: type.iconBg }}
              >
                {type.icon}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-semibold text-xs text-slate-900 group-hover:text-primary transition-colors truncate">
                    {type.label}
                  </span>
                  <Plus className="h-3.5 w-3.5 text-slate-300 group-hover:text-primary transition-colors shrink-0" />
                </div>
                <p className="text-[11px] text-slate-500 leading-snug line-clamp-1 mt-0.5">
                  {type.description}
                </p>
                <div className="mt-1 text-[10px] text-slate-400 font-medium truncate">
                  {type.category}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={val => !val && handleClose()}>
        <DialogContent className="sm:max-w-[480px] p-5 overflow-hidden">
          <div
            className="absolute top-0 left-0 w-full h-1"
            style={{ backgroundColor: selectedTypeInfo?.iconBg }}
          />
          <DialogHeader className="space-y-1">
            <DialogTitle className="flex items-center gap-2.5 text-base font-semibold">
              <span
                className="h-7 w-7 rounded-md shadow-xs flex items-center justify-center ring-1 ring-black/5 shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5"
                style={{ backgroundColor: selectedTypeInfo?.iconBg || '#0f172a' }}
              >
                {selectedTypeInfo?.icon}
              </span>
              <span>Add {selectedTypeInfo?.label}</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Configure details to start receiving alerts from {selectedTypeInfo?.label}.
            </DialogDescription>
          </DialogHeader>

          {selectedTypeInfo && (
            <form action={handleSubmit} className="space-y-3.5 pt-2">
              <input type="hidden" name="serviceId" value={serviceId} />
              <input type="hidden" name="type" value={selectedTypeInfo.value} />

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-xs font-medium">
                  Integration Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder={`e.g. Production ${selectedTypeInfo.label}`}
                  required
                  autoFocus
                  className="h-8.5 text-xs bg-slate-50 focus:bg-white transition-colors"
                />
              </div>

              {selectedTypeInfo.value === 'CLOUDWATCH' && (
                <div className="space-y-1.5">
                  <Label htmlFor="snsTopicArn" className="text-xs font-medium">
                    SNS Topic ARN <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="snsTopicArn"
                    name="snsTopicArn"
                    placeholder="arn:aws:sns:us-east-1:123456789012:opsknight-alerts"
                    required
                    autoComplete="off"
                    className="h-8.5 bg-slate-50 font-mono text-xs focus:bg-white"
                  />
                  <p className="text-[11px] text-slate-500">
                    Only signed messages from this exact topic are accepted.
                  </p>
                </div>
              )}

              <div className="bg-blue-50/70 p-3 rounded-md border border-blue-100 text-xs text-blue-700 flex gap-2.5">
                <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  After creating this integration, you will be provided with a unique{' '}
                  <strong>API Key</strong> or <strong>Webhook URL</strong> to configure in your{' '}
                  {selectedTypeInfo.label} account.
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  className="h-8 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={loading}
                  style={{
                    backgroundColor:
                      selectedTypeInfo.iconBg === '#ffffff' ? undefined : selectedTypeInfo.iconBg,
                  }}
                  className={`h-8 text-xs ${
                    selectedTypeInfo.iconBg === '#ffffff'
                      ? ''
                      : 'hover:opacity-90 transition-opacity text-white'
                  }`}
                >
                  {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Create Integration
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
