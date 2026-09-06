'use client';

export default function ExportButtonSimple({ onClick }: { onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            type="button"
            style={{
                display: 'block',
                padding: '0.75rem 1.4rem',
                borderRadius: '999px',
                border: 'none',
                backgroundColor: '#d32f2f',
                color: 'white',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(17, 24, 39, 0.06)',
            }}
        >
            📥 Export CSV
        </button>
    );
}

