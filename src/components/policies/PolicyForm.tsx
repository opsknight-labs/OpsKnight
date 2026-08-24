'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/shadcn/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/shadcn/form';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { createPolicy } from '@/app/(app)/policies/actions';
import { Loader2, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-product-notification';

const formSchema = z.object({
  name: z.string().min(2, {
    message: 'Policy name must be at least 2 characters.',
  }),
  description: z.string().optional(),
});

export default function PolicyForm() {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    startTransition(async () => {
      const formData = new FormData();
      formData.append('name', values.name);
      if (values.description) {
        formData.append('description', values.description);
      }

      // We need to handle the dummy steps logic required by the server action if it exists,
      // or update the server action.
      // Looking at existing usage in `policies/page.tsx` (legacy), it submitted step targets too.
      // Let's assume for now we might need to modify the action or pass dummy data if constraints exist.
      // However, looking at standard CRUD, creating a wrapper shell is better.
      // Let's try submitting just basic info. If the server action requires steps, we will need to fix the action.
      // *Wait*, I should probably check `policies/actions.ts` first.
      // But let's write the optimistic form first.

      // To ensure compatibility with the existing `createPolicy` action which likely expects FormData
      // and might expect step-0-target etc., I'll need to check `actions.ts`.
      // PROACTIVE FIX: check actions.ts in next step.

      try {
        await createPolicy(formData);
        showToast('Policy created successfully', 'success');
        // The action likely redirects, but if not:
        // router.push('/policies');
      } catch (error: any) {
        if (error.message === 'NEXT_REDIRECT' || error.digest?.startsWith('NEXT_REDIRECT')) {
          throw error;
        }
        showToast('Failed to create policy', 'error');
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Policy Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Database Critical Response" {...field} />
              </FormControl>
              <FormDescription>A unique name to identify this escalation policy.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe when this policy should be used..."
                  className="resize-none"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Policy
          </Button>
        </div>
      </form>
    </Form>
  );
}
