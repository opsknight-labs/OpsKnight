'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { Calendar, Pencil, Trash2, Plus } from 'lucide-react';
import type { ActionItem } from '@/lib/action-items';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';

interface PostmortemActionItemsProps {
  actionItems: ActionItem[];
  onChange: (items: ActionItem[]) => void;
  canManage?: boolean;
  users?: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
}

import { ACTION_ITEM_STATUS_CONFIG, ACTION_ITEM_PRIORITY_CONFIG } from './shared';

export default function PostmortemActionItems({
  actionItems,
  onChange,
  canManage = true,
  users = [],
}: PostmortemActionItemsProps) {
  const { userTimeZone } = useTimezone();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<Partial<ActionItem>>({
    status: 'OPEN',
    priority: 'MEDIUM',
  });

  const addItem = () => {
    if (!newItem.title) return;

    const item: ActionItem = {
      id: `action-${Date.now()}`,
      title: newItem.title,
      description: newItem.description || '',
      owner: newItem.owner,
      dueDate: newItem.dueDate,
      status: newItem.status || 'OPEN',
      priority: newItem.priority || 'MEDIUM',
    };

    onChange([...actionItems, item]);
    setNewItem({
      status: 'OPEN',
      priority: 'MEDIUM',
    });
  };

  const updateItem = (id: string, updates: Partial<ActionItem>) => {
    onChange(actionItems.map(item => (item.id === id ? { ...item, ...updates } : item)));
  };

  const deleteItem = (id: string) => {
    onChange(actionItems.filter(item => item.id !== id));
  };

  const completedCount = actionItems.filter(item => item.status === 'COMPLETED').length;
  const completionRate = actionItems.length > 0 ? (completedCount / actionItems.length) * 100 : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Add New Item Form */}
      <Card className="bg-gradient-to-br from-white to-slate-50">
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg">Action Items</CardTitle>
            {actionItems.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {completedCount}/{actionItems.length} completed
                </span>
                <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      completionRate === 100 ? 'bg-green-500' : 'bg-blue-500'
                    )}
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                placeholder="e.g., Add monitoring for service X"
                value={newItem.title || ''}
                onChange={e => setNewItem({ ...newItem, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={newItem.priority || 'MEDIUM'}
                onValueChange={value =>
                  setNewItem({ ...newItem, priority: value as ActionItem['priority'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTION_ITEM_PRIORITY_CONFIG).map(([value, config]) => (
                    <SelectItem key={value} value={value}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={newItem.status || 'OPEN'}
                onValueChange={value =>
                  setNewItem({ ...newItem, status: value as ActionItem['status'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTION_ITEM_STATUS_CONFIG).map(([value, config]) => (
                    <SelectItem key={value} value={value}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              rows={2}
              placeholder="Detailed description of the action item..."
              value={newItem.description || ''}
              onChange={e => setNewItem({ ...newItem, description: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {users.length > 0 && (
              <div className="space-y-1.5">
                <Label>Owner</Label>
                <Select
                  value={newItem.owner || '_unassigned'}
                  onValueChange={value =>
                    setNewItem({ ...newItem, owner: value === '_unassigned' ? undefined : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_unassigned">Unassigned</SelectItem>
                    {users.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Due Date</Label>
              <Input
                type="date"
                value={newItem.dueDate || ''}
                onChange={e => setNewItem({ ...newItem, dueDate: e.target.value })}
              />
            </div>
          </div>
          <Button onClick={addItem} disabled={!newItem.title} className="w-fit">
            <Plus className="w-4 h-4 mr-2" />
            Add Action Item
          </Button>
        </CardContent>
      </Card>

      {/* Action Items List */}
      {actionItems.length > 0 && (
        <div className="flex flex-col gap-2">
          {actionItems.map(item => {
            const isOverdue =
              item.dueDate && new Date(item.dueDate) < new Date() && item.status !== 'COMPLETED';
            const owner = users.find(u => u.id === item.owner);
            const statusConfig =
              ACTION_ITEM_STATUS_CONFIG[item.status as keyof typeof ACTION_ITEM_STATUS_CONFIG] ||
              ACTION_ITEM_STATUS_CONFIG.OPEN;
            const priorityConfig =
              ACTION_ITEM_PRIORITY_CONFIG[
                item.priority as keyof typeof ACTION_ITEM_PRIORITY_CONFIG
              ] || ACTION_ITEM_PRIORITY_CONFIG.MEDIUM;

            return (
              <Card
                key={item.id}
                className={cn('bg-white border-2 border-l-4', statusConfig.border)}
              >
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={statusConfig.variant} size="xs">
                          {statusConfig.label}
                        </Badge>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold',
                            priorityConfig.bg,
                            priorityConfig.color
                          )}
                        >
                          {priorityConfig.label} Priority
                        </span>
                        {isOverdue && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-500">
                            Overdue
                          </span>
                        )}
                      </div>
                      <h4 className="text-base font-semibold mb-1">{item.title}</h4>
                      <div className="my-1">
                        <ActionItemJiraBadge
                          actionItemId={item.id}
                          externalIssue={item.externalIssue}
                          canManage={canManage}
                          compact
                        />
                      </div>
                      {item.description && (
                        <p className="text-sm text-muted-foreground mb-1">{item.description}</p>
                      )}
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {owner && (
                          <span className="flex items-center gap-1">
                            <UserAvatar
                              userId={owner.id}
                              name={owner.name}
                              gender={owner.gender}
                              size="xs"
                            />
                            {owner.name}
                          </span>
                        )}
                        {item.dueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Due: {formatDateTime(item.dueDate, userTimeZone, { format: 'date' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => deleteItem(item.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Edit Form */}
                  {editingId === item.id && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-md flex flex-col gap-2">
                      <div className="space-y-1.5">
                        <Label>Title</Label>
                        <Input
                          value={item.title}
                          onChange={e => updateItem(item.id, { title: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Textarea
                          rows={2}
                          value={item.description}
                          onChange={e => updateItem(item.id, { description: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label>Status</Label>
                          <Select
                            value={item.status}
                            onValueChange={value =>
                              updateItem(item.id, { status: value as ActionItem['status'] })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(ACTION_ITEM_STATUS_CONFIG).map(([value, config]) => (
                                <SelectItem key={value} value={value}>
                                  {config.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Priority</Label>
                          <Select
                            value={item.priority}
                            onValueChange={value =>
                              updateItem(item.id, { priority: value as ActionItem['priority'] })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(ACTION_ITEM_PRIORITY_CONFIG).map(
                                ([value, config]) => (
                                  <SelectItem key={value} value={value}>
                                    {config.label}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {users.length > 0 && (
                        <div className="space-y-1.5">
                          <Label>Owner</Label>
                          <Select
                            value={item.owner || '_unassigned'}
                            onValueChange={value =>
                              updateItem(item.id, {
                                owner: value === '_unassigned' ? undefined : value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Unassigned" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_unassigned">Unassigned</SelectItem>
                              {users.map(user => (
                                <SelectItem key={user.id} value={user.id}>
                                  {user.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label>Due Date</Label>
                        <Input
                          type="date"
                          value={
                            item.dueDate ? new Date(item.dueDate).toISOString().split('T')[0] : ''
                          }
                          onChange={e => updateItem(item.id, { dueDate: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
