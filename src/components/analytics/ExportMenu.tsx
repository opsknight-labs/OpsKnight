'use client';

import { useState } from 'react';
import ExportButton from './ExportButton';

interface ExportMenuProps {
  filters: {
    team?: string;
    service?: string;
    assignee?: string;
    status?: string;
    urgency?: string;
    window?: string;
  };
}

export default function ExportMenu({ filters }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="analytics-export-menu" style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="glass-button primary analytics-export-trigger"
        type="button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.4rem',
          borderRadius: '999px',
          border: 'none',
          backgroundColor: 'var(--primary-color)',
          color: 'white',
          fontWeight: 600,
          fontSize: '0.9rem',
          cursor: 'pointer',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <span>📥</span>
        Export Data
        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <>
          <div
            className="analytics-export-overlay"
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 99,
            }}
          />
          <div className="analytics-export-dropdown">
            <div className="analytics-export-options">
              <div className="analytics-export-option">
                <ExportButton filters={filters} format="csv" />
                <p className="analytics-export-description">
                  Export as CSV with formatted data and metrics
                </p>
              </div>
              <div className="analytics-export-option">
                <ExportButton filters={filters} format="pdf" />
                <p className="analytics-export-description">
                  Export as PDF with charts and visualizations
                </p>
              </div>
              <div className="analytics-export-option">
                <ExportButton filters={filters} format="excel" />
                <p className="analytics-export-description">Export as Excel with multiple sheets</p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
