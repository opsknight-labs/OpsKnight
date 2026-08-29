'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-product-notification';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { User, Mail, Shield, Building2, Briefcase, Globe, Phone, Bell } from 'lucide-react';

export type UserEditData = {
  id: string;
  name: string;
  email: string;
  role: string;
  department?: string | null;
  jobTitle?: string | null;
  timeZone?: string | null;
  phoneNumber?: string | null;
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  pushNotificationsEnabled?: boolean;
  whatsappNotificationsEnabled?: boolean;
};

type UserEditModalProps = {
  user: UserEditData;
  isOpen: boolean;
  onClose: () => void;
  canManageRole: boolean;
  updateProfile: (
    userId: string,
    formData: FormData
  ) => Promise<{ error?: string; success?: boolean } | undefined>;
};

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
];

export default function UserEditModal({
  user,
  isOpen,
  onClose,
  canManageRole,
  updateProfile,
}: UserEditModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [department, setDepartment] = useState(user.department || '');
  const [jobTitle, setJobTitle] = useState(user.jobTitle || '');
  const [timeZone, setTimeZone] = useState(user.timeZone || 'UTC');
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber || '');
  const [emailNotifications, setEmailNotifications] = useState(
    Boolean(user.emailNotificationsEnabled)
  );
  const [smsNotifications, setSmsNotifications] = useState(Boolean(user.smsNotificationsEnabled));
  const [pushNotifications, setPushNotifications] = useState(
    Boolean(user.pushNotificationsEnabled)
  );
  const [whatsappNotifications, setWhatsappNotifications] = useState(
    Boolean(user.whatsappNotificationsEnabled)
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', name);
    formData.append('email', email);
    if (canManageRole) {
      formData.append('role', role);
    }
    formData.append('department', department);
    formData.append('jobTitle', jobTitle);
    formData.append('timeZone', timeZone);
    formData.append('phoneNumber', phoneNumber);
    formData.append('emailNotificationsEnabled', emailNotifications ? 'true' : 'false');
    formData.append('smsNotificationsEnabled', smsNotifications ? 'true' : 'false');
    formData.append('pushNotificationsEnabled', pushNotifications ? 'true' : 'false');
    formData.append('whatsappNotificationsEnabled', whatsappNotifications ? 'true' : 'false');

    startTransition(async () => {
      try {
        const result = await updateProfile(user.id, formData);
        if (result?.error) {
          showToast(result.error, 'error');
        } else {
          showToast('User profile updated successfully', 'success');
          onClose();
          router.refresh();
        }
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Failed to update user profile',
          'error'
        );
      }
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <User className="h-4 w-4 text-primary" />
            Edit Profile: {user.name}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Update account information, notification channels, and operational roles.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Name & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                Full Name
              </Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                required
                disabled={isPending}
                className="text-xs h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                Email Address
              </Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={isPending}
                className="text-xs h-9"
              />
            </div>
          </div>

          {/* Role & Timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                User Role
              </Label>
              <Select value={role} onValueChange={setRole} disabled={!canManageRole || isPending}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADMIN" className="text-xs font-medium text-rose-600">
                    Administrator (Full Access)
                  </SelectItem>
                  <SelectItem value="RESPONDER" className="text-xs font-medium text-indigo-600">
                    Responder (Incident Access)
                  </SelectItem>
                  <SelectItem value="USER" className="text-xs font-medium text-sky-600">
                    User (Member View)
                  </SelectItem>
                  <SelectItem value="AUDITOR" className="text-xs font-medium text-amber-600">
                    Auditor (Read-Only)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                Time Zone
              </Label>
              <Select value={timeZone} onValueChange={setTimeZone} disabled={isPending}>
                <SelectTrigger className="text-xs h-9">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {COMMON_TIMEZONES.map(tz => (
                    <SelectItem key={tz} value={tz} className="text-xs">
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Department & Job Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                Department
              </Label>
              <Input
                placeholder="e.g. Infrastructure, Backend"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                disabled={isPending}
                className="text-xs h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                Job Title
              </Label>
              <Input
                placeholder="e.g. Staff Site Reliability Engineer"
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                disabled={isPending}
                className="text-xs h-9"
              />
            </div>
          </div>

          {/* Phone Number for Paging */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              Phone Number (E.164 format)
            </Label>
            <Input
              type="tel"
              placeholder="+1234567890"
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              disabled={isPending}
              className="text-xs h-9"
            />
            <p className="text-[10px] text-muted-foreground">
              Required for SMS and automated phone call incident alerts.
            </p>
          </div>

          {/* Notification Preferences */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              Direct Alert Channels
            </Label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notif-email"
                  checked={emailNotifications}
                  onCheckedChange={c => setEmailNotifications(Boolean(c))}
                  disabled={isPending}
                />
                <label htmlFor="notif-email" className="cursor-pointer text-xs">
                  Email Alerts
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notif-sms"
                  checked={smsNotifications}
                  onCheckedChange={c => setSmsNotifications(Boolean(c))}
                  disabled={isPending}
                />
                <label htmlFor="notif-sms" className="cursor-pointer text-xs">
                  SMS Text Messages
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notif-push"
                  checked={pushNotifications}
                  onCheckedChange={c => setPushNotifications(Boolean(c))}
                  disabled={isPending}
                />
                <label htmlFor="notif-push" className="cursor-pointer text-xs">
                  Browser Push
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notif-whatsapp"
                  checked={whatsappNotifications}
                  onCheckedChange={c => setWhatsappNotifications(Boolean(c))}
                  disabled={isPending}
                />
                <label htmlFor="notif-whatsapp" className="cursor-pointer text-xs">
                  WhatsApp Direct
                </label>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-3 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="text-xs h-8 font-medium"
            >
              {isPending ? 'Saving...' : 'Save Profile Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
