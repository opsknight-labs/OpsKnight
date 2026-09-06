import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import WhatsappProviderSettings from '@/components/settings/WhatsappProviderSettings';

// Mock FormField
vi.mock('@/components/ui/FormField', () => ({
  default: ({
    label,
    value,
    placeholder,
    helperText,
  }: {
    label: string;
    value?: string;
    placeholder?: string;
    helperText?: string;
  }) => (
    <div>
      <label>{label}</label>
      <input
        data-testid={`input-${label.replace(/\s+/g, '-').toLowerCase()}`}
        value={value}
        placeholder={placeholder}
      />
      {helperText && <span>{helperText}</span>}
    </div>
  ),
}));

describe('WhatsappProviderSettings', () => {
  const defaultProps = {
    whatsappNumber: '',
    whatsappContentSid: '',
    whatsappAccountSid: '',
    whatsappAuthToken: '',
    onWhatsappNumberChange: vi.fn(),
    onWhatsappContentSidChange: vi.fn(),
    onWhatsappAccountSidChange: vi.fn(),
    onWhatsappAuthTokenChange: vi.fn(),
    smsEnabled: false,
    smsProvider: 'twilio' as const,
  };

  it('renders WhatsApp section header', () => {
    render(<WhatsappProviderSettings {...defaultProps} />);
    expect(screen.getByText('WhatsApp Notifications')).toBeInTheDocument();
  });

  it('renders all WhatsApp form fields', () => {
    render(<WhatsappProviderSettings {...defaultProps} />);
    expect(screen.getByTestId('input-whatsapp-business-number')).toBeInTheDocument();
    expect(screen.getByTestId('input-whatsapp-account-sid-(optional)')).toBeInTheDocument();
    expect(screen.getByTestId('input-whatsapp-auth-token-(optional)')).toBeInTheDocument();
    expect(screen.getByTestId('input-whatsapp-template-sid-(optional)')).toBeInTheDocument();
  });

  it('shows requirements note', () => {
    render(<WhatsappProviderSettings {...defaultProps} />);
    expect(screen.getByText('WhatsApp requirements:')).toBeInTheDocument();
    expect(screen.getByText('Requires a Twilio WhatsApp Business API number.')).toBeInTheDocument();
  });

  it('shows Twilio reuse note when SMS uses Twilio', () => {
    render(<WhatsappProviderSettings {...defaultProps} smsEnabled={true} smsProvider="twilio" />);
    expect(screen.getByText(/WhatsApp can reuse your Twilio SMS credentials/)).toBeInTheDocument();
  });

  it('shows standalone note when SMS does not use Twilio', () => {
    render(<WhatsappProviderSettings {...defaultProps} smsEnabled={true} smsProvider="aws-sns" />);
    expect(screen.getByText(/SMS is not using Twilio/)).toBeInTheDocument();
  });

  it('shows standalone note when SMS is disabled', () => {
    render(<WhatsappProviderSettings {...defaultProps} smsEnabled={false} />);
    expect(screen.getByText(/SMS is not using Twilio/)).toBeInTheDocument();
  });
});
