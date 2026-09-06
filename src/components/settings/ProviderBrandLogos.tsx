'use client';

import React from 'react';

type LogoProps = {
  className?: string;
  size?: number;
};

/**
 * Official Twilio Logo Mark (Red circular badge with 4 dots)
 */
export function TwilioLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Twilio"
    >
      <circle cx="12" cy="12" r="11" fill="#F22F46" />
      <circle cx="8.5" cy="8.5" r="1.8" fill="white" />
      <circle cx="15.5" cy="8.5" r="1.8" fill="white" />
      <circle cx="8.5" cy="15.5" r="1.8" fill="white" />
      <circle cx="15.5" cy="15.5" r="1.8" fill="white" />
    </svg>
  );
}

/**
 * Official WhatsApp Logo Mark (Green speech bubble with phone handset)
 */
export function WhatsAppLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="WhatsApp"
    >
      <circle cx="12" cy="12" r="11" fill="#25D366" />
      <path
        d="M12.01 4C7.59 4 4 7.59 4 12.01c0 1.54.44 2.98 1.2 4.21L4.4 19.6l3.52-.77c1.17.67 2.53 1.05 3.99 1.05 4.42 0 8.01-3.59 8.01-8.01S16.43 4 12.01 4zm4.84 11.39c-.2.57-1.16 1.09-1.61 1.13-.43.04-.98.06-1.58-.13-.37-.12-.84-.28-1.46-.55-2.58-1.12-4.26-3.72-4.39-3.9-.13-.17-1.04-1.39-1.04-2.65s.66-1.88.89-2.14c.23-.26.51-.33.68-.33.17 0 .34 0 .49.01.16.01.37-.06.58.44.21.5.73 1.77.79 1.9.06.13.1.28.02.45-.09.16-.13.26-.26.41-.13.15-.27.34-.39.46-.13.13-.26.27-.11.53.15.26.67 1.1 1.44 1.79.99.88 1.83 1.16 2.09 1.29.26.13.41.11.56-.06.15-.17.65-.76.82-1.02.17-.26.35-.22.58-.13.23.09 1.48.7 1.73.83.25.13.42.19.48.3.06.11.06.64-.14 1.21z"
        fill="white"
      />
    </svg>
  );
}

/**
 * Official Resend Logo Mark (Monochrome geometric R mark)
 */
export function ResendLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Resend"
    >
      <rect width="24" height="24" rx="5" fill="#000000" />
      <path
        d="M6 18V6H13C15.7614 6 18 8.23858 18 11C18 13.7614 15.7614 16 13 16H9.5V18H6ZM9.5 8.5V13.5H13C14.3807 13.5 15.5 12.3807 15.5 11C15.5 9.61929 14.3807 8.5 13 8.5H9.5ZM13.2 14.4L17.8 18.5H14.5L10.8 14.8L13.2 14.4Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * Official SendGrid Logo Mark (4 blue geometric blocks)
 */
export function SendGridLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="SendGrid"
    >
      <rect width="24" height="24" rx="5" fill="#002244" />
      <rect x="4.5" y="4.5" width="6.5" height="6.5" rx="1.5" fill="#009DD9" />
      <rect x="13" y="4.5" width="6.5" height="6.5" rx="1.5" fill="#1A82E2" />
      <rect x="4.5" y="13" width="6.5" height="6.5" rx="1.5" fill="#00B3EC" />
      <rect x="13" y="13" width="6.5" height="6.5" rx="1.5" fill="#009DD9" />
    </svg>
  );
}

/**
 * Official Amazon SES Logo Mark (AWS Navy + Amazon Orange mail cube)
 */
export function AmazonSesLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Amazon SES"
    >
      <rect width="24" height="24" rx="5" fill="#232F3E" />
      <path
        d="M12 4.5L4.5 8.8V15.2L12 19.5L19.5 15.2V8.8L12 4.5Z"
        fill="#FF9900"
        fillOpacity="0.25"
        stroke="#FF9900"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M4.5 8.8L12 13L19.5 8.8" stroke="#FF9900" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 13V19.5" stroke="#FF9900" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="12" cy="8.8" r="1.5" fill="#FFFFFF" />
    </svg>
  );
}

/**
 * Custom SMTP Logo Mark (Indigo Enterprise Mail Server)
 */
export function SmtpLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Custom SMTP"
    >
      <rect width="24" height="24" rx="5" fill="#4F46E5" />
      <rect x="4.5" y="6" width="15" height="12" rx="2" stroke="white" strokeWidth="1.5" />
      <path
        d="M5 7.5L12 12.5L19 7.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="15.5" r="1.2" fill="#38BDF8" />
    </svg>
  );
}

/**
 * Official Web Push / PWA Logo Mark (Purple PWA standard mark)
 */
export function WebPushLogo({ className = '', size = 20 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Web Push (PWA)"
    >
      <rect width="24" height="24" rx="5" fill="#5A0FC8" />
      <path
        d="M5 14L8 6H10.5L13.5 14H11.5L10.8 12.2H7.7L7 14H5ZM8.2 10.6H10.3L9.2 7.8L8.2 10.6ZM14.5 6.5H18.5V8.2H14.5V6.5ZM14.5 9.4H18.5V11.1H14.5V9.4ZM14.5 12.3H18.5V14H14.5V12.3Z"
        fill="white"
      />
      <circle cx="19.5" cy="5.5" r="2" fill="#00E5FF" />
    </svg>
  );
}

export { JiraLogo, SlackLogo } from '@/components/common/BrandLogos';
import { JiraLogo, SlackLogo } from '@/components/common/BrandLogos';

/**
 * Helper to render the official logo based on provider/channel key
 */
export function getProviderBrandLogo(key: string, size = 24) {
  const sizeClass = size >= 24 ? 'h-6 w-6' : size >= 20 ? 'h-5 w-5' : 'h-4 w-4';
  switch (key.toLowerCase()) {
    case 'jira':
    case 'atlassian':
      return <JiraLogo className={sizeClass} />;
    case 'slack':
      return <SlackLogo className={sizeClass} />;
    case 'twilio':
      return <TwilioLogo size={size} />;
    case 'whatsapp':
      return <WhatsAppLogo size={size} />;
    case 'resend':
      return <ResendLogo size={size} />;
    case 'sendgrid':
      return <SendGridLogo size={size} />;
    case 'ses':
    case 'amazon-ses':
    case 'amazonses':
      return <AmazonSesLogo size={size} />;
    case 'smtp':
      return <SmtpLogo size={size} />;
    case 'web-push':
    case 'webpush':
    case 'push':
    case 'pwa':
      return <WebPushLogo size={size} />;
    default:
      return <SmtpLogo size={size} />;
  }
}
