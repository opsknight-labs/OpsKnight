/**
 * Type definitions for notification settings
 * These types replace `any` usage in notification provider components
 */

// SMS Provider Types
export type SmsProvider = 'twilio' | 'aws-sns';

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface AwsSnsConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SmsSettings {
  enabled: boolean;
  provider: SmsProvider;
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

// Push Notification Provider Types (PWA Web Push only)
export type PushProvider = 'web-push';

export interface PushSettings {
  enabled: boolean;
  provider: PushProvider;
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
  vapidKeyHistory?: Array<{ publicKey: string; privateKey: string }>;
}

// WhatsApp Settings
export interface WhatsappSettings {
  number: string;
  contentSid?: string;
  accountSid?: string;
  authToken?: string;
}

// Email Provider Types
export type EmailProvider = 'resend' | 'sendgrid' | 'smtp' | 'ses';

export interface ResendConfig {
  apiKey: string;
  fromEmail: string;
}

export interface SendGridConfig {
  apiKey: string;
  fromEmail: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
  secure?: boolean;
}

export interface SesConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  fromEmail: string;
}

// Combined Notification Settings (for API responses)
export interface NotificationSettings {
  sms?: SmsSettings;
  push?: PushSettings;
  whatsapp?: WhatsappSettings;
}

// Provider Configuration (used by SystemNotificationSettings)
export interface ProviderRecord {
  id: string;
  provider: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: Date | string;
}

// Form Field Configuration
export interface ProviderFieldConfig {
  name: string;
  label: string;
  type: 'text' | 'password' | 'email' | 'tel' | 'number' | 'textarea' | 'checkbox';
  required: boolean;
  placeholder?: string;
}

export interface ProviderConfigSchema {
  key: string;
  name: string;
  description: string;
  fields: ProviderFieldConfig[];
  requiresProvider?: string;
}

// Save status for forms
export type SaveStatus = 'idle' | 'success' | 'error';
