'use client';

import { useState } from 'react';
import { Card, Button, FormField, Switch } from '@/components/ui';

interface StatusPageSetupWizardProps {
  initialData?: {
    name?: string;
    enabled?: boolean;
    logoUrl?: string;
    primaryColor?: string;
    serviceIds?: string[];
  };
  allServices: Array<{ id: string; name: string }>;
  onComplete: (data: {
    name: string;
    enabled: boolean;
    logoUrl?: string;
    primaryColor?: string;
    serviceIds: string[];
  }) => void;
  onSkip?: () => void;
}

const STEPS = [
  { id: 1, title: 'Basic Information', description: 'Set up your status page name and visibility' },
  { id: 2, title: 'Branding', description: 'Customize colors and logo' },
  { id: 3, title: 'Services', description: 'Select services to display' },
  { id: 4, title: 'Review', description: 'Review and publish your status page' },
];

export default function StatusPageSetupWizard({
  initialData,
  allServices,
  onComplete,
  onSkip,
}: StatusPageSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [wizardData, setWizardData] = useState({
    name: initialData?.name || 'Status Page',
    enabled: initialData?.enabled ?? true,
    logoUrl: initialData?.logoUrl || '/logo.svg',
    primaryColor: initialData?.primaryColor || '#667eea',
    serviceIds: initialData?.serviceIds || ([] as string[]),
  });

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = () => {
    onComplete(wizardData);
  };

  const toggleService = (serviceId: string) => {
    setWizardData(prev => ({
      ...prev,
      serviceIds: prev.serviceIds.includes(serviceId)
        ? prev.serviceIds.filter(id => id !== serviceId)
        : [...prev.serviceIds, serviceId],
    }));
  };

  const progressPercentage = (currentStep / STEPS.length) * 100;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Progress Bar */}
      <div style={{ marginBottom: 'var(--spacing-6)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: 'var(--spacing-2)',
          }}
        >
          {STEPS.map(step => (
            <div
              key={step.id}
              style={{
                flex: 1,
                textAlign: 'center',
                opacity: step.id <= currentStep ? 1 : 0.5,
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background:
                    step.id < currentStep
                      ? 'var(--primary-color)'
                      : step.id === currentStep
                        ? 'var(--primary-color)'
                        : '#e5e7eb',
                  color: step.id <= currentStep ? 'white' : '#6b7280',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '600',
                  margin: '0 auto var(--spacing-2)',
                  fontSize: 'var(--font-size-sm)',
                }}
              >
                {step.id < currentStep ? '✓' : step.id}
              </div>
              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: step.id <= currentStep ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {step.title}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            height: '4px',
            background: '#e5e7eb',
            borderRadius: '2px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: 'var(--primary-color)',
              width: `${progressPercentage}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Step Content */}
      <Card>
        <div style={{ padding: 'var(--spacing-6)' }}>
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <h2
              style={{
                fontSize: 'var(--font-size-2xl)',
                fontWeight: '700',
                marginBottom: 'var(--spacing-2)',
              }}
            >
              {STEPS[currentStep - 1].title}
            </h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>
              {STEPS[currentStep - 1].description}
            </p>
          </div>

          {/* Step 1: Basic Information */}
          {currentStep === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <FormField
                type="input"
                label="Status Page Name"
                value={wizardData.name}
                onChange={e => setWizardData({ ...wizardData, name: e.target.value })}
                required
                helperText="The name displayed at the top of your status page"
              />
              <Switch
                checked={wizardData.enabled}
                onChange={checked => setWizardData({ ...wizardData, enabled: checked })}
                label="Enable Status Page"
                helperText="When enabled, your status page will be publicly accessible"
              />
            </div>
          )}

          {/* Step 2: Branding */}
          {currentStep === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--spacing-2)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: '500',
                  }}
                >
                  Logo URL
                </label>
                <FormField
                  type="input"
                  inputType="url"
                  label="Logo URL"
                  value={wizardData.logoUrl}
                  onChange={e => setWizardData({ ...wizardData, logoUrl: e.target.value })}
                  placeholder="https://yourcompany.com/logo.png"
                  helperText="Optional: URL to your company logo"
                />
              </div>
              <div>
                <label
                  style={{
                    display: 'block',
                    marginBottom: 'var(--spacing-2)',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: '500',
                  }}
                >
                  Primary Color
                </label>
                <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
                  <input
                    type="color"
                    value={wizardData.primaryColor}
                    onChange={e => setWizardData({ ...wizardData, primaryColor: e.target.value })}
                    style={{
                      width: '60px',
                      height: '40px',
                      border: '1px solid #e5e7eb',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                    }}
                  />
                  <FormField
                    type="input"
                    inputType="text"
                    label="Primary Color"
                    value={wizardData.primaryColor}
                    onChange={e => setWizardData({ ...wizardData, primaryColor: e.target.value })}
                    placeholder="#667eea"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Services */}
          {currentStep === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--spacing-2)',
                }}
              >
                Select which services to display on your status page. You can change this later.
              </p>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--spacing-2)',
                  maxHeight: '400px',
                  overflowY: 'auto',
                }}
              >
                {allServices.map(service => (
                  <label
                    key={service.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: 'var(--spacing-3)',
                      border: '1px solid #e5e7eb',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      background: wizardData.serviceIds.includes(service.id) ? '#f0f9ff' : 'white',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={wizardData.serviceIds.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                      style={{ marginRight: 'var(--spacing-3)' }}
                    />
                    <span>{service.name}</span>
                  </label>
                ))}
                {allServices.length === 0 && (
                  <p
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      padding: 'var(--spacing-4)',
                    }}
                  >
                    No services available. Create services first to display them on the status page.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {currentStep === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
              <div
                style={{
                  padding: 'var(--spacing-4)',
                  background: '#f9fafb',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <h3
                  style={{
                    fontSize: 'var(--font-size-lg)',
                    fontWeight: '600',
                    marginBottom: 'var(--spacing-4)',
                  }}
                >
                  Review Your Settings
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                  <div>
                    <strong>Name:</strong> {wizardData.name}
                  </div>
                  <div>
                    <strong>Status:</strong> {wizardData.enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  {wizardData.logoUrl && (
                    <div>
                      <strong>Logo:</strong> {wizardData.logoUrl}
                    </div>
                  )}
                  <div>
                    <strong>Primary Color:</strong>{' '}
                    <span
                      style={{
                        display: 'inline-block',
                        width: '20px',
                        height: '20px',
                        background: wizardData.primaryColor,
                        border: '1px solid #e5e7eb',
                        borderRadius: '4px',
                        verticalAlign: 'middle',
                        marginLeft: 'var(--spacing-2)',
                      }}
                    />
                    {wizardData.primaryColor}
                  </div>
                  <div>
                    <strong>Services:</strong> {wizardData.serviceIds.length} selected
                  </div>
                </div>
              </div>
              <div
                style={{
                  padding: 'var(--spacing-4)',
                  background: '#fef3c7',
                  border: '1px solid #fde68a',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <p style={{ fontSize: 'var(--font-size-sm)', color: '#92400e', margin: 0 }}>
                  You can modify these settings anytime from the status page settings.
                </p>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 'var(--spacing-6)',
              paddingTop: 'var(--spacing-4)',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <div>
              {onSkip && (
                <Button type="button" variant="ghost" onClick={onSkip}>
                  Skip Wizard
                </Button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 'var(--spacing-3)' }}>
              {currentStep > 1 && (
                <Button type="button" variant="secondary" onClick={handlePrevious}>
                  Previous
                </Button>
              )}
              <Button type="button" variant="primary" onClick={handleNext}>
                {currentStep === STEPS.length ? 'Complete Setup' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
