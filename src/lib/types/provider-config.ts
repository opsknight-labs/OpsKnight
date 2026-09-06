/**
 * Type definitions for notification provider configurations
 *
 * These types define the structure of provider configuration objects
 * stored in the NotificationProvider.config JSON field.
 */

/**
 * Twilio SMS provider configuration
 */
export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  // WhatsApp configuration (stored with Twilio)
  whatsappNumber?: string;
  whatsappContentSid?: string;
  whatsappEnabled?: boolean;
  whatsappAccountSid?: string;
  whatsappAuthToken?: string;
}

/**
 * AWS SNS SMS provider configuration
 */
export interface AwsSnsConfig {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Web Push provider configuration
 */
export interface WebPushConfig {
  vapidPublicKey?: string;
  vapidPrivateKey?: string;
  vapidSubject?: string;
  vapidKeyHistory?: Array<{ publicKey: string; privateKey: string }>;
}

/**
 * Resend email provider configuration
 */
export interface ResendConfig {
  apiKey?: string;
  fromEmail?: string;
}

/**
 * SendGrid email provider configuration
 */
export interface SendGridConfig {
  apiKey?: string;
  fromEmail?: string;
}

/**
 * SMTP email provider configuration
 */
export interface SmtpConfig {
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  secure?: boolean;
  fromEmail?: string;
}

/**
 * Amazon SES email provider configuration
 */
export interface SesConfig {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  fromEmail?: string;
}

/**
 * Union type for all provider configurations
 */
export type ProviderConfig =
  | TwilioConfig
  | AwsSnsConfig
  | WebPushConfig
  | ResendConfig
  | SendGridConfig
  | SmtpConfig
  | SesConfig;

/**
 * Type guard to check if a value is a valid provider config object
 */
export function isProviderConfig(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard for Twilio configuration
 */
export function isTwilioConfig(config: unknown): config is TwilioConfig {
  if (!isProviderConfig(config)) return false;
  return (
    typeof config.accountSid === 'string' ||
    typeof config.authToken === 'string' ||
    typeof config.fromNumber === 'string'
  );
}

/**
 * Type guard for AWS SNS configuration
 */
export function isAwsSnsConfig(config: unknown): config is AwsSnsConfig {
  if (!isProviderConfig(config)) return false;
  return typeof config.accessKeyId === 'string' || typeof config.secretAccessKey === 'string';
}

/**
 * Type guard for Web Push configuration
 */
export function isWebPushConfig(config: unknown): config is WebPushConfig {
  if (!isProviderConfig(config)) return false;
  return typeof config.vapidPublicKey === 'string' || typeof config.vapidPrivateKey === 'string';
}

/**
 * Type guard for Resend configuration
 */
export function isResendConfig(config: unknown): config is ResendConfig {
  if (!isProviderConfig(config)) return false;
  return typeof config.apiKey === 'string';
}

/**
 * Type guard for SendGrid configuration
 */
export function isSendGridConfig(config: unknown): config is SendGridConfig {
  if (!isProviderConfig(config)) return false;
  return typeof config.apiKey === 'string';
}

/**
 * Type guard for SMTP configuration
 */
export function isSmtpConfig(config: unknown): config is SmtpConfig {
  if (!isProviderConfig(config)) return false;
  return typeof config.host === 'string' && typeof config.user === 'string';
}

/**
 * Type guard for SES configuration
 */
export function isSesConfig(config: unknown): config is SesConfig {
  if (!isProviderConfig(config)) return false;
  return typeof config.accessKeyId === 'string' || typeof config.secretAccessKey === 'string';
}
