'use client';

import { FormField, Select } from '@/components/ui';

type CustomFieldInputProps = {
    field: {
        id: string;
        name: string;
        key: string;
        type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'URL' | 'EMAIL';
        required: boolean;
        defaultValue?: string | null;
        options?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    value?: string;
    onChange: (value: string) => void;
    error?: string;
};

export default function CustomFieldInput({ field, value = '', onChange, error }: CustomFieldInputProps) {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        onChange(e.target.value);
    };

    const renderInput = () => {
        switch (field.type) {
            case 'TEXT':
                return (
                    <FormField
                        type="input"
                        inputType="text"
                        label={field.name}
                        value={value || field.defaultValue || ''}
                        onChange={handleChange}
                        required={field.required}
                        error={error}
                    />
                );

            case 'NUMBER':
                return (
                    <FormField
                        type="input"
                        inputType="number"
                        label={field.name}
                        value={value || field.defaultValue || ''}
                        onChange={handleChange}
                        required={field.required}
                        error={error}
                    />
                );

            case 'DATE':
                return (
                    <FormField
                        type="input"
                        inputType="date"
                        label={field.name}
                        value={value || field.defaultValue || ''}
                        onChange={handleChange}
                        required={field.required}
                        error={error}
                    />
                );

            case 'SELECT':
                const options = Array.isArray(field.options) ? field.options : [];
                return (
                    <div>
                        <label style={{ display: 'block', marginBottom: 'var(--spacing-2)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                            {field.name} {field.required && <span style={{ color: 'var(--color-error)' }}>*</span>}
                        </label>
                        <Select
                            value={value || field.defaultValue || ''}
                            onChange={handleChange}
                            options={options.map((opt: string) => ({ value: opt, label: opt }))}
                            required={field.required}
                        />
                        {error && (
                            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginTop: 'var(--spacing-1)' }}>
                                {error}
                            </p>
                        )}
                    </div>
                );

            case 'BOOLEAN':
                return (
                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)', fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                            <input
                                type="checkbox"
                                checked={value === 'true' || (field.defaultValue === 'true' && !value)}
                                onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
                                required={field.required}
                            />
                            {field.name}
                            {field.required && <span style={{ color: 'var(--color-error)' }}>*</span>}
                        </label>
                        {error && (
                            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginTop: 'var(--spacing-1)' }}>
                                {error}
                            </p>
                        )}
                    </div>
                );

            case 'URL':
                return (
                    <FormField
                        type="input"
                        inputType="url"
                        label={field.name}
                        value={value || field.defaultValue || ''}
                        onChange={handleChange}
                        required={field.required}
                        error={error}
                        placeholder="https://example.com"
                    />
                );

            case 'EMAIL':
                return (
                    <FormField
                        type="input"
                        inputType="email"
                        label={field.name}
                        value={value || field.defaultValue || ''}
                        onChange={handleChange}
                        required={field.required}
                        error={error}
                        placeholder="user@example.com"
                    />
                );

            default:
                return null;
        }
    };

    return <div>{renderInput()}</div>;
}







