import React from 'react';

export interface TourSceneProps {
  title: string;
  subtitle: string;
  durationInFrames: number;
}

export const TourSceneOverlay: React.FC<TourSceneProps> = ({ title, subtitle }) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 40,
        left: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 22px',
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 9999,
        color: '#ffffff',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          padding: '4px 10px',
          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
          borderRadius: 9999,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        OpsKnight
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{subtitle}</div>
      </div>
    </div>
  );
};
