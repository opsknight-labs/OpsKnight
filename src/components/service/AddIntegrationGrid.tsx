'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/shadcn/card';
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
import { Badge } from '@/components/ui/shadcn/badge';

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
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">Add New Integration</h2>
          <p className="text-sm text-slate-500">Select a tool to connect with OpsKnight.</p>
        </div>
        <div className="w-full md:w-72 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pb-2">
        {categories.map(category => (
          <Badge
            key={category}
            variant={selectedCategory === category ? 'default' : 'outline'}
            className={`
              cursor-pointer px-3 py-1.5 text-xs font-medium transition-all
              ${
                selectedCategory === category
                  ? 'shadow-md scale-105'
                  : 'hover:bg-slate-100 hover:border-slate-300 text-slate-600'
              }
            `}
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </Badge>
        ))}
      </div>

      {filteredIntegrations.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-slate-100 rounded-xl bg-slate-50/30">
          <div className="mx-auto h-12 w-12 text-slate-300 mb-3 flex items-center justify-center">
            <Search className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-medium text-slate-900">No integrations found</h3>
          <p className="text-slate-500 mt-1">
            Try adjusting your search or filter to find what you're looking for.
          </p>
          <Button
            variant="link"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('All');
            }}
            className="mt-2"
          >
            Clear all filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredIntegrations.map(type => (
            <Card
              key={type.value}
              className="group relative overflow-hidden cursor-pointer border-slate-200 bg-white/50 hover:bg-white hover:border-primary/20 hover:shadow-lg transition-all duration-300"
              onClick={() => handleTypeClick(type.value)}
            >
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{
                  background: `linear-gradient(to bottom right, ${type.iconBg}0d, transparent)`,
                }}
              />

              <div className="p-5 flex flex-col h-full gap-4 relative">
                <div className="flex items-start justify-between">
                  <div
                    className="w-12 h-12 flex items-center justify-center rounded-xl shadow-sm group-hover:scale-105 transition-transform duration-300 ring-1 ring-black/5"
                    style={{ backgroundColor: type.iconBg }}
                  >
                    {type.icon}
                  </div>
                  <div
                    className="opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0"
                    style={{ color: type.iconBg === '#ffffff' ? '#0f172a' : type.iconBg }}
                  >
                    <Plus className="h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-slate-900 group-hover:text-primary transition-colors">
                      {type.label}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 min-h-[2.5em]">
                    {type.description}
                  </p>
                </div>

                <div className="pt-2 mt-auto flex items-center text-xs font-medium text-slate-400 group-hover:text-primary/80 transition-colors">
                  <span className="truncate">{type.category}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={val => !val && handleClose()}>
        <DialogContent className="sm:max-w-[500px] overflow-hidden">
          <div
            className="absolute top-0 left-0 w-full h-1"
            style={{ backgroundColor: selectedTypeInfo?.iconBg }}
          />
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <span
                className="h-10 w-10 rounded-lg shadow-sm flex items-center justify-center ring-1 ring-black/5"
                style={{ backgroundColor: selectedTypeInfo?.iconBg || '#0f172a' }}
              >
                {selectedTypeInfo?.icon}
              </span>
              Add {selectedTypeInfo?.label}
            </DialogTitle>
            <DialogDescription className="pt-1">
              Configure details to start receiving alerts from {selectedTypeInfo?.label}.
            </DialogDescription>
          </DialogHeader>

          {selectedTypeInfo && (
            <form action={handleSubmit} className="space-y-6 pt-4">
              <input type="hidden" name="serviceId" value={serviceId} />
              <input type="hidden" name="type" value={selectedTypeInfo.value} />

              <div className="space-y-2">
                <Label htmlFor="name">
                  Integration Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="name"
                  name="name"
                  placeholder={`e.g. Production ${selectedTypeInfo.label}`}
                  required
                  autoFocus
                  className="bg-slate-50 focus:bg-white transition-colors"
                />
              </div>

              {selectedTypeInfo.value === 'CLOUDWATCH' && (
                <div className="space-y-2">
                  <Label htmlFor="snsTopicArn">
                    SNS Topic ARN <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="snsTopicArn"
                    name="snsTopicArn"
                    placeholder="arn:aws:sns:us-east-1:123456789012:opsknight-alerts"
                    required
                    autoComplete="off"
                    className="bg-slate-50 font-mono text-xs focus:bg-white"
                  />
                  <p className="text-xs text-slate-500">
                    Only signed messages from this exact topic are accepted.
                  </p>
                </div>
              )}

              <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-100 text-xs text-blue-700 flex gap-3">
                <Info className="h-5 w-5 shrink-0 text-blue-500" />
                <div className="leading-relaxed">
                  After creating this integration, you will be provided with a unique{' '}
                  <strong>API Key</strong> or <strong>Webhook URL</strong> to configure in your{' '}
                  {selectedTypeInfo.label} account.
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="ghost" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  style={{
                    // Use brand color for primary button if available, but ensure contrast
                    // Fallback to primary color if brand color is white/light
                    backgroundColor:
                      selectedTypeInfo.iconBg === '#ffffff' ? undefined : selectedTypeInfo.iconBg,
                  }}
                  className={
                    selectedTypeInfo.iconBg === '#ffffff'
                      ? ''
                      : 'hover:opacity-90 transition-opacity'
                  }
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
