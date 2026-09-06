'use client';

import FormField from '@/components/ui/FormField';
import type { WhatsappSettings, SmsProvider } from '@/types/notification-types';

interface WhatsappProviderSettingsProps {
  whatsappNumber: string;
  whatsappContentSid: string;
  whatsappAccountSid: string;
  whatsappAuthToken: string;
  onWhatsappNumberChange: (value: string) => void;
  onWhatsappContentSidChange: (value: string) => void;
  onWhatsappAccountSidChange: (value: string) => void;
  onWhatsappAuthTokenChange: (value: string) => void;
  smsEnabled: boolean;
  smsProvider: SmsProvider;
}

export default function WhatsappProviderSettings({
  whatsappNumber,
  whatsappContentSid,
  whatsappAccountSid,
  whatsappAuthToken,
  onWhatsappNumberChange,
  onWhatsappContentSidChange,
  onWhatsappAccountSidChange,
  onWhatsappAuthTokenChange,
  smsEnabled,
  smsProvider,
}: WhatsappProviderSettingsProps) {
  return (
    <section className="settings-subsection">
      <div className="settings-subsection-header">
        <div>
          <h3>WhatsApp Notifications</h3>
          <p>Configure WhatsApp Business API via Twilio for incident notifications.</p>
        </div>
      </div>
      <div className="settings-subsection-body">
        <div className="settings-note info">
          <strong>WhatsApp requirements:</strong>
          <ul>
            <li>Requires a Twilio WhatsApp Business API number.</li>
            <li>Provide WhatsApp credentials or reuse Twilio SMS credentials.</li>
            <li>Users must enable WhatsApp notifications in their preferences.</li>
          </ul>
        </div>

        <FormField
          type="input"
          label="WhatsApp Business Number"
          inputType="tel"
          value={whatsappNumber}
          onChange={e => onWhatsappNumberChange(e.target.value)}
          placeholder="+1234567890"
          helperText="Your Twilio WhatsApp Business API number in E.164 format."
          fullWidth
        />
        <FormField
          type="input"
          label="WhatsApp Account SID (Optional)"
          inputType="text"
          value={whatsappAccountSid}
          onChange={e => onWhatsappAccountSidChange(e.target.value)}
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          helperText="If blank, the SMS Account SID is used when available."
          fullWidth
        />
        <FormField
          type="input"
          label="WhatsApp Auth Token (Optional)"
          inputType="password"
          value={whatsappAuthToken}
          onChange={e => onWhatsappAuthTokenChange(e.target.value)}
          placeholder="Your Twilio auth token"
          helperText="If blank, the SMS Auth Token is used when available."
          fullWidth
        />
        <FormField
          type="input"
          label="WhatsApp Template SID (Optional)"
          inputType="text"
          value={whatsappContentSid}
          onChange={e => onWhatsappContentSidChange(e.target.value)}
          placeholder="HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          helperText="Required to send notifications outside the 24-hour window."
          fullWidth
        />
        {!smsEnabled || smsProvider !== 'twilio' ? (
          <div className="settings-note info">
            <strong>Note:</strong> SMS is not using Twilio. WhatsApp will rely on the credentials
            above.
          </div>
        ) : (
          <div className="settings-note info">
            <strong>Note:</strong> WhatsApp can reuse your Twilio SMS credentials if you leave the
            WhatsApp credentials blank.
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Helper to build WhatsApp settings object from component state
 */
export function buildWhatsappSettings(
  whatsappNumber: string,
  whatsappContentSid: string,
  whatsappAccountSid: string,
  whatsappAuthToken: string
): WhatsappSettings {
  return {
    number: whatsappNumber,
    contentSid: whatsappContentSid,
    accountSid: whatsappAccountSid,
    authToken: whatsappAuthToken,
  };
}
