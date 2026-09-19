'use client';

import React from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Key, Clock, ArrowRight, Users, Lock } from 'lucide-react';
import Link from 'next/link';
import { EncryptionMigrationPanel } from '../EncryptionMigrationPanel';

interface OperationsViewProps {
  readonly canManageEncryption?: boolean;
  readonly canReadEncryption?: boolean;
}

export function OperationsView({
  canManageEncryption = false,
  canReadEncryption = true,
}: OperationsViewProps) {
  return (
    <div className="space-y-6">
      {/* Scope Disclaimer */}
      <div className="p-4 rounded-xl border border-border/80 bg-muted/20 flex items-start gap-3 text-xs text-muted-foreground">
        <Lock className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-foreground">Operational Lifecycle Controls</p>
          <p className="leading-relaxed">
            Execute and monitor cryptographic migrations, verifiable data-at-rest transitions, and
            organizational retention policies. All lifecycle tasks run asynchronously via dedicated
            background workers with durable audit logging.
          </p>
        </div>
      </div>

      {/* 1. Encryption Lifecycle Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Key className="h-4 w-4 text-amber-500" />
              <span>Cryptographic Envelope &amp; Secret Lifecycle</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Monitor key versions, verify envelope integrity, preview migration blast radius, and
              execute re-wrap tasks.
            </p>
          </div>
        </div>

        {canReadEncryption ? (
          <EncryptionMigrationPanel canManageEncryption={canManageEncryption} />
        ) : (
          <Card className="p-6 text-center border-dashed">
            <p className="text-xs text-muted-foreground">
              You do not have permission to view encryption lifecycle operations. Requires{' '}
              <code>ENCRYPTION_READ</code>.
            </p>
          </Card>
        )}
      </div>

      {/* 2. Privacy & Data Subject Requests Operational Boundary */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              <span>Data Subject Rights &amp; Privacy Operations</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              Per strict data-minimization architecture, individual DSR discovery and personal data
              redaction occur within the dedicated Privacy Requests portal.
            </p>
          </div>
        </div>

        <Card className="border-border/80 bg-card">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <CardTitle className="text-sm font-bold text-foreground">
                  Privacy Requests &amp; DSR Processing Portal
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  Execute user data export, erasure, correction, and verification workflows under
                  role-based authorization.
                </CardDescription>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Isolated PII Boundary
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              To prevent accidental PII leakage across general compliance reporting, individual
              subject lookups, email addresses, and personal data exports are strictly partitioned.
            </p>

            <Button asChild variant="outline" size="sm" className="gap-2 text-xs">
              <Link href="/settings/privacy-requests">
                <span>Navigate to Privacy Requests Portal</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* 3. Data Retention Lifecycle */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-500" />
              <span>Data Retention &amp; Disposal Policies</span>
            </h3>
            <p className="text-xs text-muted-foreground">
              System retention periods for immutable audit trails, ephemeral sessions, and incident
              history.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-border/80 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Security Audit Logs</span>
              <Badge variant="outline" className="text-[10px] font-mono">
                365 Days
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Cryptographic hashes, access events, and privilege transitions retained for mandatory
              statutory compliance.
            </p>
          </Card>

          <Card className="border-border/80 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Active User Sessions</span>
              <Badge variant="outline" className="text-[10px] font-mono">
                30 Days Max
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              JWT session cookies enforce sliding expiration with token-version revocation upon
              logout or credential reset.
            </p>
          </Card>

          <Card className="border-border/80 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground">Ephemeral Run Logs</span>
              <Badge variant="outline" className="text-[10px] font-mono">
                14 Days
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Transient worker execution payloads and intermediate step logs purged automatically
              after terminal settlement.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
