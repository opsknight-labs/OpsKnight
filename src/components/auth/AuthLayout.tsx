'use client';

import React from 'react';
import LoginAnimation from '@/components/auth/LoginAnimation'; // Ensure this path is correct
import Link from 'next/link';
import { cn } from '@/lib/utils'; // Assuming utils location

interface AuthLayoutProps {
  children: React.ReactNode;
  showAnimation?: boolean;
}

export function AuthLayout({ children, showAnimation = true }: AuthLayoutProps) {
  return (
    <div className="relative min-h-[100dvh] lg:h-[100dvh] w-full overflow-hidden bg-background text-primary-foreground font-sans selection:bg-primary/20">
      {/* Background Layers - Shared visuals */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/95 to-primary/90" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:64px_64px] opacity-20" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_50%,rgba(255,255,255,0.1),transparent_25%),radial-gradient(circle_at_85%_30%,rgba(255,255,255,0.05),transparent_25%)] mix-blend-overlay" />

      {/* Main Container */}
      <div className="relative mx-auto flex min-h-[100dvh] lg:h-full w-full max-w-[1920px] flex-col px-6 py-6 sm:px-12 lg:px-16 xl:px-24 overflow-hidden">
        {/* Header - Enhanced Branding */}
        <header className="flex items-center justify-between gap-4 py-1 mb-2 border-b border-white/5">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-950/30 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)] backdrop-blur-sm group transition-all duration-500 hover:border-emerald-500/60 hover:shadow-[0_0_25px_rgba(16,185,129,0.4)]"
            >
              <img
                src="/logo.svg"
                alt="OpsKnight"
                className="h-7 w-7 opacity-90 group-hover:opacity-100 transition-opacity"
              />
            </Link>
            <div>
              <h1
                className="text-2xl font-extrabold tracking-tight text-white drop-shadow-md"
                style={{ letterSpacing: '-0.02em' }}
              >
                OpsKnight
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs font-bold text-emerald-400 uppercase tracking-widest bg-emerald-950/20 px-4 py-2 rounded-full border border-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            System Operational
          </div>
        </header>

        {/* Content Body */}
        <main className="grid flex-1 items-center gap-12 lg:grid-cols-2 lg:gap-24 xl:gap-32 pb-20">
          {/* Left Side: Animated Hero */}
          <section className="hidden lg:flex h-full w-full items-center justify-center min-h-[500px] relative">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/50 to-transparent blur-3xl -z-10 opacity-30" />
            {showAnimation && <LoginAnimation />}
          </section>

          {/* Right Side: Auth Card Container */}
          <section className="flex justify-center w-full lg:justify-end">
            <div className="relative w-full max-w-[480px]">{children}</div>
          </section>
        </main>

        {/* Footer Ticker could go here if extracted, but sticking to basic layout first */}
      </div>
    </div>
  );
}

interface AuthCardProps {
  children: React.ReactNode;
  isSuccess?: boolean;
  className?: string; // Allow overrides
}

export function AuthCard({ children, isSuccess = false, className }: AuthCardProps) {
  return (
    <>
      {/* Card Backlight Effect */}
      <div
        className={cn(
          'absolute -inset-[2px] rounded-[20px] bg-gradient-to-b from-white/10 to-transparent blur-xl opacity-30 transition-all duration-1000',
          isSuccess && 'from-emerald-500 opacity-50 blur-2xl'
        )}
      />

      <div
        className={cn(
          'relative overflow-hidden rounded-2xl border bg-[#0a0a0a]/80 p-8 shadow-2xl backdrop-blur-xl transition-all duration-500',
          isSuccess
            ? 'border-emerald-500/50 shadow-[0_0_50px_rgba(16,185,129,0.2)]'
            : 'border-white/10',
          className
        )}
      >
        {children}
      </div>
    </>
  );
}
