'use client';

import { useEffect, useState } from 'react';

export type RoleMappingRule = {
  claim: string;
  value: string;
  role: 'USER' | 'ADMIN' | 'RESPONDER' | 'AUDITOR';
};

type Props = {
  initialMappings?: RoleMappingRule[] | null;
  onChange?: (mappings: RoleMappingRule[]) => void;
};

export default function RoleMappingEditor({ initialMappings, onChange }: Props) {
  const parsedMappings = Array.isArray(initialMappings) ? initialMappings : [];
  const [mappings, setMappings] = useState<RoleMappingRule[]>(parsedMappings);

  useEffect(() => {
    onChange?.(mappings);
  }, [mappings, onChange]);

  const addRule = () => {
    setMappings([...mappings, { claim: 'groups', value: '', role: 'USER' }]);
  };

  const removeRule = (index: number) => {
    setMappings(mappings.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, field: keyof RoleMappingRule, value: string) => {
    const newMappings = [...mappings];
    newMappings[index] = { ...newMappings[index], [field]: value };
    setMappings(newMappings);
  };

  return (
    <div className="role-mapping-container">
      <input type="hidden" name="roleMapping" value={JSON.stringify(mappings)} />

      {mappings.length === 0 && (
        <div className="settings-empty-state">
          No role mappings configured. Users will be assigned the default role (USER).
        </div>
      )}

      <div className="role-mapping-list">
        {mappings.map((rule, index) => (
          <div key={index} className="role-mapping-card">
            <div className="role-mapping-inputs">
              <div className="role-mapping-field">
                <label>Claim</label>
                <input
                  type="text"
                  placeholder="e.g. groups"
                  value={rule.claim}
                  onChange={e => updateRule(index, 'claim', e.target.value)}
                  required
                />
              </div>
              <div className="role-mapping-operator">=</div>
              <div className="role-mapping-field">
                <label>Value</label>
                <input
                  type="text"
                  placeholder="e.g. admins"
                  value={rule.value}
                  onChange={e => updateRule(index, 'value', e.target.value)}
                  required
                />
              </div>
              <div className="role-mapping-arrow">→</div>
              <div className="role-mapping-field">
                <label>Assign Role</label>
                <select
                  value={rule.role}
                  onChange={e => updateRule(index, 'role', e.target.value as any)}
                >
                  <option value="USER">User</option>
                  <option value="RESPONDER">Responder</option>
                  <option value="AUDITOR">Auditor</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeRule(index)}
              className="role-mapping-remove"
              aria-label="Remove rule"
              title="Remove rule"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button type="button" onClick={addRule} className="settings-secondary-button full-width">
        + Add Role Mapping Rule
      </button>

      <p className="settings-help-text">
        Rules are evaluated in order. The first match determines the user's role.
      </p>

      <style jsx>{`
        .role-mapping-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-top: 1rem;
        }

        .settings-empty-state {
          padding: 1.5rem;
          background: var(--bg-primary);
          border: 1px dashed var(--border);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          text-align: center;
          font-size: var(--font-size-sm);
        }

        .role-mapping-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .role-mapping-card {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-sm);
          transition: box-shadow 0.2s ease;
        }

        .role-mapping-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--border-hover);
        }

        .role-mapping-inputs {
          display: flex;
          align-items: center;
          flex: 1;
          gap: 0.75rem;
        }

        .role-mapping-field {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          flex: 1;
        }

        .role-mapping-field label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
        }

        .role-mapping-field input,
        .role-mapping-field select {
          width: 100%;
          padding: 0.5rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
          background: var(--bg-secondary);
          color: var(--text-primary);
        }

        .role-mapping-operator,
        .role-mapping-arrow {
          color: var(--text-muted);
          font-weight: bold;
          padding-top: 1rem; /* Visual alignment with inputs */
        }

        .role-mapping-remove {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-full);
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.2s;
        }

        .role-mapping-remove:hover {
          background: var(--color-error-bg, rgba(220, 38, 38, 0.1));
          color: var(--color-error);
        }

        .full-width {
          width: 100%;
          display: flex;
          justify-content: center;
        }

        .settings-help-text {
          color: var(--text-secondary);
          font-size: var(--font-size-xs);
          margin-top: 0.5rem;
        }
      `}</style>
    </div>
  );
}
