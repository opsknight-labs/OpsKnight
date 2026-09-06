import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SmsProviderSettings from '@/components/settings/SmsProviderSettings';

// Mock Button component
vi.mock('@/components/ui/Button', () => ({
  default: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

// Mock FormField component
vi.mock('@/components/ui/FormField', () => ({
  default: ({
    type,
    label,
    value,
    onChange,
    checked,
    placeholder,
    helperText,
    options,
  }: {
    type: string;
    label: string;
    value?: string;
    onChange?: ((v: boolean) => void) | ((e: { target: { value: string } }) => void);
    checked?: boolean;
    placeholder?: string;
    helperText?: string;
    options?: { value: string; label: string }[];
  }) => {
    if (type === 'switch') {
      return (
        <label data-testid={`switch-${label.replace(/\s+/g, '-').toLowerCase()}`}>
          <input
            type="checkbox"
            checked={checked}
            onChange={e => (onChange as (v: boolean) => void)?.(e.target.checked)}
          />
          {label}
        </label>
      );
    }
    if (type === 'select') {
      return (
        <select
          data-testid={`select-${label.replace(/\s+/g, '-').toLowerCase()}`}
          value={value}
          onChange={e => (onChange as (e: { target: { value: string } }) => void)?.(e)}
        >
          {options?.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <div>
        <label>{label}</label>
        <input
          data-testid={`input-${label.replace(/\s+/g, '-').toLowerCase()}`}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={e => (onChange as (e: { target: { value: string } }) => void)?.(e)}
        />
        {helperText && <span>{helperText}</span>}
      </div>
    );
  },
}));

describe('SmsProviderSettings', () => {
  const defaultProps = {
    enabled: false,
    provider: 'twilio' as const,
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFromNumber: '',
    awsRegion: 'us-east-1',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    onEnabledChange: vi.fn(),
    onProviderChange: vi.fn(),
    onTwilioAccountSidChange: vi.fn(),
    onTwilioAuthTokenChange: vi.fn(),
    onTwilioFromNumberChange: vi.fn(),
    onAwsRegionChange: vi.fn(),
    onAwsAccessKeyIdChange: vi.fn(),
    onAwsSecretAccessKeyChange: vi.fn(),
    onTestSms: vi.fn(),
    isPending: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SMS section header', () => {
    render(<SmsProviderSettings {...defaultProps} />);
    expect(screen.getByText('SMS Notifications')).toBeInTheDocument();
    expect(
      screen.getByText('Configure SMS provider for incident notifications.')
    ).toBeInTheDocument();
  });

  it('renders enable switch', () => {
    render(<SmsProviderSettings {...defaultProps} />);
    expect(screen.getByTestId('switch-enable-sms-notifications')).toBeInTheDocument();
  });

  it('calls onEnabledChange when toggle is clicked', () => {
    render(<SmsProviderSettings {...defaultProps} />);
    const checkbox = screen.getByTestId('switch-enable-sms-notifications').querySelector('input');
    fireEvent.click(checkbox!);
    expect(defaultProps.onEnabledChange).toHaveBeenCalledWith(true);
  });

  it('shows provider select when enabled', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={true} />);
    expect(screen.getByTestId('select-sms-provider')).toBeInTheDocument();
  });

  it('shows Twilio fields when Twilio is selected', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={true} provider="twilio" />);
    expect(screen.getByTestId('input-twilio-account-sid')).toBeInTheDocument();
    expect(screen.getByTestId('input-twilio-auth-token')).toBeInTheDocument();
    expect(screen.getByTestId('input-from-phone-number')).toBeInTheDocument();
  });

  it('shows AWS SNS fields when AWS SNS is selected', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={true} provider="aws-sns" />);
    expect(screen.getByTestId('input-aws-region')).toBeInTheDocument();
    expect(screen.getByTestId('input-aws-access-key-id')).toBeInTheDocument();
    expect(screen.getByTestId('input-aws-secret-access-key')).toBeInTheDocument();
  });

  it('shows Test SMS button when enabled', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={true} />);
    expect(screen.getByText('Test SMS')).toBeInTheDocument();
  });

  it('disables Test SMS button when isPending', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={true} isPending={true} />);
    const button = screen.getByText('Test SMS');
    expect(button).toBeDisabled();
  });

  it('calls onTestSms when Test SMS button is clicked', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={true} />);
    fireEvent.click(screen.getByText('Test SMS'));
    expect(defaultProps.onTestSms).toHaveBeenCalled();
  });

  it('does not show configuration fields when disabled', () => {
    render(<SmsProviderSettings {...defaultProps} enabled={false} />);
    expect(screen.queryByTestId('select-sms-provider')).not.toBeInTheDocument();
    expect(screen.queryByText('Test SMS')).not.toBeInTheDocument();
  });
});
