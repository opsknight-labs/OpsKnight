import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock form components
type IncidentFormData = {
  title: string;
  description: string;
  urgency: string;
  serviceId: string;
};

type IncidentFormProps = {
  onSubmit: (data: IncidentFormData) => void;
  initialData?: Partial<IncidentFormData>;
};

const IncidentForm = ({ onSubmit, initialData }: IncidentFormProps) => {
  const [formData, setFormData] = React.useState<IncidentFormData>({
    title: '',
    description: '',
    urgency: 'MEDIUM',
    serviceId: '',
    ...initialData,
  });

  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.title || formData.title.length < 3) {
      newErrors.title = 'Title must be at least 3 characters';
    }

    if (!formData.description) {
      newErrors.description = 'Description is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form onSubmit={handleSubmit} data-testid="incident-form">
      <input
        type="text"
        placeholder="Title"
        value={formData.title}
        onChange={e => setFormData({ ...formData, title: e.target.value })}
        aria-label="Title"
      />
      {errors.title && <span role="alert">{errors.title}</span>}

      <textarea
        placeholder="Description"
        value={formData.description}
        onChange={e => setFormData({ ...formData, description: e.target.value })}
        aria-label="Description"
      />
      {errors.description && <span role="alert">{errors.description}</span>}

      <select
        value={formData.urgency}
        onChange={e => setFormData({ ...formData, urgency: e.target.value })}
        aria-label="Urgency"
      >
        <option value="LOW">Low</option>
        <option value="MEDIUM">Medium</option>
        <option value="HIGH">High</option>
      </select>

      <button type="submit">Create Incident</button>
    </form>
  );
};

type UserFormData = {
  name: string;
  email: string;
  role: string;
};

type UserFormProps = {
  onSubmit: (data: UserFormData) => void;
};

const UserForm = ({ onSubmit }: UserFormProps) => {
  const [formData, setFormData] = React.useState<UserFormData>({
    name: '',
    email: '',
    role: 'USER',
  });

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSubmit(formData);
      }}
    >
      <input
        type="text"
        placeholder="Name"
        value={formData.name}
        onChange={e => setFormData({ ...formData, name: e.target.value })}
        aria-label="Name"
      />
      <input
        type="email"
        placeholder="Email"
        value={formData.email}
        onChange={e => setFormData({ ...formData, email: e.target.value })}
        aria-label="Email"
      />
      <select
        value={formData.role}
        onChange={e => setFormData({ ...formData, role: e.target.value })}
        aria-label="Role"
      >
        <option value="USER">User</option>
        <option value="ADMIN">Admin</option>
        <option value="VIEWER">Viewer</option>
      </select>
      <button type="submit">Create User</button>
    </form>
  );
};

describe('Form Components', () => {
  describe('Incident Form', () => {
    it('should render all form fields', () => {
      render(<IncidentForm onSubmit={vi.fn()} />);

      expect(screen.getByLabelText('Title')).toBeDefined();
      expect(screen.getByLabelText('Description')).toBeDefined();
      expect(screen.getByLabelText('Urgency')).toBeDefined();
      expect(screen.getByText('Create Incident')).toBeDefined();
    });

    it('should validate required fields', async () => {
      const onSubmit = vi.fn();
      render(<IncidentForm onSubmit={onSubmit} />);

      const submitButton = screen.getByText('Create Incident');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Title must be at least 3 characters')).toBeDefined();
        expect(screen.getByText('Description is required')).toBeDefined();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should submit valid form data', async () => {
      const onSubmit = vi.fn();
      render(<IncidentForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Database Issue' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'DB is slow' } });
      fireEvent.change(screen.getByLabelText('Urgency'), { target: { value: 'HIGH' } });

      fireEvent.click(screen.getByText('Create Incident'));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          title: 'Database Issue',
          description: 'DB is slow',
          urgency: 'HIGH',
          serviceId: '',
        });
      });
    });

    it('should populate form with initial data', () => {
      const initialData = {
        title: 'Existing Incident',
        description: 'Description here',
        urgency: 'MEDIUM',
        serviceId: 'svc-123',
      };

      render(<IncidentForm onSubmit={vi.fn()} initialData={initialData} />);

      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      const descInput = screen.getByLabelText('Description') as HTMLTextAreaElement;

      expect(titleInput.value).toBe('Existing Incident');
      expect(descInput.value).toBe('Description here');
    });
  });

  describe('User Form', () => {
    it('should render user form fields', () => {
      render(<UserForm onSubmit={vi.fn()} />);

      expect(screen.getByLabelText('Name')).toBeDefined();
      expect(screen.getByLabelText('Email')).toBeDefined();
      expect(screen.getByLabelText('Role')).toBeDefined();
    });

    it('should submit user data', async () => {
      const onSubmit = vi.fn();
      render(<UserForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'John Doe' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'john@example.com' } });
      fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ADMIN' } });

      fireEvent.click(screen.getByText('Create User'));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({
          name: 'John Doe',
          email: 'john@example.com',
          role: 'ADMIN',
        });
      });
    });
  });

  describe('Form Validation', () => {
    it('should validate email format', () => {
      const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      };

      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('user@domain')).toBe(false);
    });

    it('should validate required fields', () => {
      const validateRequired = (value: string) => {
        return value.trim().length > 0;
      };

      expect(validateRequired('valid')).toBe(true);
      expect(validateRequired('')).toBe(false);
      expect(validateRequired('   ')).toBe(false);
    });

    it('should validate minimum length', () => {
      const validateMinLength = (value: string, minLength: number) => {
        return value.length >= minLength;
      };

      expect(validateMinLength('test', 3)).toBe(true);
      expect(validateMinLength('ab', 3)).toBe(false);
    });
  });
});
