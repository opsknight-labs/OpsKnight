'use client';

import React from 'react';
import LoginAnimation from '@/components/auth/LoginAnimation';
import AuthBrand from '@/components/auth/AuthBrand';
import { cn } from '@/lib/utils';

interface AuthLayoutProps {
  children: React.ReactNode;
  showAnimation?: boolean;
  /** Passed through on successful auth so the globe settles to "all resolved". */
  isSuccess?: boolean;
}

export function AuthLayout({ children, showAnimation = true, isSuccess = false }: AuthLayoutProps) {
  return (
    <div className="relative min-h-[100dvh] lg:h-[100dvh] w-full overflow-hidden bg-[#06080b] font-sans selection:bg-red-500/20">
      <div className="flex min-h-[100dvh] w-full flex-col lg:h-full lg:flex-row">
        {showAnimation && (
          <section className="relative hidden h-full overflow-hidden border-r border-[#1a202c] lg:flex lg:w-1/2">
            <LoginAnimation resolved={isSuccess} />
          </section>
        )}

        {showAnimation && (
          <div className="relative h-[164px] w-full shrink-0 overflow-hidden border-b border-[#1a202c] lg:hidden">
            <LoginAnimation variant="banner" resolved={isSuccess} />
          </div>
        )}

        <section
          className={cn(
            'flex w-full flex-1 flex-col justify-between overflow-y-auto bg-background px-6 py-8 text-foreground transition-colors duration-200 sm:px-12 lg:px-16 2xl:px-24',
            showAnimation ? 'lg:w-1/2' : 'w-full'
          )}
        >
          {!showAnimation ? (
            <div className="w-full py-2">
              <AuthBrand compact />
            </div>
          ) : (
            <div aria-hidden="true" className="h-2" />
          )}

          <div className="my-auto flex w-full items-center justify-center">{children}</div>

          <a
            href="https://opsknight.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-3 text-center text-[11px] font-medium text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:text-slate-400 dark:hover:text-slate-200 dark:focus-visible:ring-white 2xl:text-xs"
          >
            <svg className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span>Your instance. Your data. Your rules.</span>
          </a>
        </section>
      </div>
    </div>
  );
}

interface AuthCardProps {
  children: React.ReactNode;
  isSuccess?: boolean;
  className?: string;
}

export function AuthCard({ children, className }: AuthCardProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[360px] py-4 sm:max-w-[400px] 2xl:max-w-[460px] min-[2000px]:max-w-[520px]',
        className
      )}
    >
      {children}
    </div>
  );
}
