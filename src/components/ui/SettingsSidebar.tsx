'use client';

interface SettingsSidebarItem {
  id: string;
  label: string;
  icon?: string;
  badge?: string | number;
  children?: SettingsSidebarItem[];
}

interface SettingsSidebarProps {
  items: SettingsSidebarItem[];
  activeItem: string;
  onItemClick: (itemId: string) => void;
  className?: string;
}

export default function SettingsSidebar({
  items,
  activeItem,
  onItemClick,
  className = '',
}: SettingsSidebarProps) {
  return (
    <nav
      className={`settings-sidebar ${className}`}
      style={{
        width: '240px',
        minWidth: '240px',
        background: '#ffffff',
        borderRight: '1px solid #e5e7eb',
        padding: 'var(--spacing-4)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
        {items.map(item => (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => onItemClick(item.id)}
              style={{
                width: '100%',
                padding: 'var(--spacing-3) var(--spacing-4)',
                background: activeItem === item.id ? '#f3f4f6' : 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: activeItem === item.id ? 'var(--primary-color)' : 'var(--text-primary)',
                fontWeight: activeItem === item.id ? '600' : '500',
                fontSize: 'var(--font-size-sm)',
                textAlign: 'left',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => {
                if (activeItem !== item.id) {
                  e.currentTarget.style.background = '#f9fafb';
                }
              }}
              onMouseLeave={e => {
                if (activeItem !== item.id) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}>
                {item.icon && <span>{item.icon}</span>}
                {item.label}
              </span>
              {item.badge && (
                <span
                  style={{
                    background: activeItem === item.id ? 'var(--primary-color)' : '#e5e7eb',
                    color: activeItem === item.id ? 'white' : 'var(--text-muted)',
                    fontSize: 'var(--font-size-xs)',
                    padding: '0.125rem 0.5rem',
                    borderRadius: '999px',
                    fontWeight: '600',
                  }}
                >
                  {item.badge}
                </span>
              )}
            </button>
            {item.children && activeItem === item.id && (
              <div
                style={{
                  marginLeft: 'var(--spacing-4)',
                  marginTop: 'var(--spacing-1)',
                  paddingLeft: 'var(--spacing-4)',
                  borderLeft: '2px solid #e5e7eb',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--spacing-1)',
                }}
              >
                {item.children.map(child => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => onItemClick(child.id)}
                    style={{
                      width: '100%',
                      padding: 'var(--spacing-2) var(--spacing-3)',
                      background: activeItem === child.id ? '#f3f4f6' : 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-md)',
                      color: activeItem === child.id ? 'var(--primary-color)' : 'var(--text-muted)',
                      fontWeight: activeItem === child.id ? '600' : '400',
                      fontSize: 'var(--font-size-sm)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {child.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </nav>
  );
}
