'use client';

import FormField from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import type { SmsProvider, SmsSettings } from '@/types/notification-types';

interface SmsProviderSettingsProps {
  enabled: boolean;
  provider: SmsProvider;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioFromNumber: string;
  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  onEnabledChange: (enabled: boolean) => void;
  onProviderChange: (provider: SmsProvider) => void;
  onTwilioAccountSidChange: (value: string) => void;
  onTwilioAuthTokenChange: (value: string) => void;
  onTwilioFromNumberChange: (value: string) => void;
  onAwsRegionChange: (value: string) => void;
  onAwsAccessKeyIdChange: (value: string) => void;
  onAwsSecretAccessKeyChange: (value: string) => void;
  onTestSms: () => Promise<void>;
  isPending: boolean;
}

export default function SmsProviderSettings({
  enabled,
  provider,
  twilioAccountSid,
  twilioAuthToken,
  twilioFromNumber,
  awsRegion,
  awsAccessKeyId,
  awsSecretAccessKey,
  onEnabledChange,
  onProviderChange,
  onTwilioAccountSidChange,
  onTwilioAuthTokenChange,
  onTwilioFromNumberChange,
  onAwsRegionChange,
  onAwsAccessKeyIdChange,
  onAwsSecretAccessKeyChange,
  onTestSms,
  isPending,
}: SmsProviderSettingsProps) {
  return (
    <section className="settings-subsection">
      <div className="settings-subsection-header">
        <div>
          <h3>SMS Notifications</h3>
          <p>Configure SMS provider for incident notifications.</p>
        </div>
      </div>
      <div className="settings-subsection-body">
        <FormField
          type="switch"
          label="Enable SMS Notifications"
          checked={enabled}
          onChange={onEnabledChange}
        />

        {enabled && (
          <>
            <FormField
              type="select"
              label="SMS Provider"
              value={provider}
              onChange={e => onProviderChange(e.target.value as SmsProvider)}
              options={[
                { value: 'twilio', label: 'Twilio' },
                { value: 'aws-sns', label: 'AWS SNS' },
              ]}
              fullWidth
            />

            {provider === 'twilio' && (
              <>
                <FormField
                  type="input"
                  label="Twilio Account SID"
                  inputType="text"
                  value={twilioAccountSid}
                  onChange={e => onTwilioAccountSidChange(e.target.value)}
                  placeholder="Twilio Account SID"
                  fullWidth
                />
                <FormField
                  type="input"
                  label="Twilio Auth Token"
                  inputType="password"
                  value={twilioAuthToken}
                  onChange={e => onTwilioAuthTokenChange(e.target.value)}
                  placeholder="Your auth token"
                  fullWidth
                />
                <FormField
                  type="input"
                  label="From Phone Number"
                  inputType="tel"
                  value={twilioFromNumber}
                  onChange={e => onTwilioFromNumberChange(e.target.value)}
                  placeholder="+1234567890"
                  helperText="E.164 format (e.g., +1234567890)"
                  fullWidth
                />
                <div className="settings-note info">
                  <strong>Note: Twilio Trial Account</strong>
                  <br />
                  Trial accounts can only send SMS to verified phone numbers. Verify recipient
                  numbers at{' '}
                  <a
                    href="https://twilio.com/user/account/phone-numbers/verified"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link-inline"
                  >
                    twilio.com/user/account/phone-numbers/verified
                  </a>{' '}
                  or upgrade your Twilio account to send to any number.
                </div>
              </>
            )}

            {provider === 'aws-sns' && (
              <>
                <FormField
                  type="input"
                  label="AWS Region"
                  inputType="text"
                  value={awsRegion}
                  onChange={e => onAwsRegionChange(e.target.value)}
                  placeholder="us-east-1"
                  fullWidth
                />
                <FormField
                  type="input"
                  label="AWS Access Key ID"
                  inputType="text"
                  value={awsAccessKeyId}
                  onChange={e => onAwsAccessKeyIdChange(e.target.value)}
                  placeholder="AWS Access Key ID"
                  fullWidth
                />
                <FormField
                  type="input"
                  label="AWS Secret Access Key"
                  inputType="password"
                  value={awsSecretAccessKey}
                  onChange={e => onAwsSecretAccessKeyChange(e.target.value)}
                  placeholder="Your secret key"
                  fullWidth
                />
              </>
            )}

            <div className="settings-inline-actions">
              <Button variant="secondary" onClick={onTestSms} disabled={isPending}>
                Test SMS
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Helper to build SMS settings object from component state
 */
export function buildSmsSettings(
  enabled: boolean,
  provider: SmsProvider,
  twilioAccountSid: string,
  twilioAuthToken: string,
  twilioFromNumber: string,
  awsRegion: string,
  awsAccessKeyId: string,
  awsSecretAccessKey: string
): SmsSettings {
  return {
    enabled,
    provider,
    ...(provider === 'twilio' && {
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      fromNumber: twilioFromNumber,
    }),
    ...(provider === 'aws-sns' && {
      region: awsRegion,
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    }),
  };
}
