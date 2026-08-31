'use client';

import './SettingsPageHeader.css';
import { useState, useRef, useEffect } from 'react';
import _Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, Search } from 'lucide-react';
import { SETTINGS_NAV_SECTIONS, type SettingsNavItem } from './navConfig';
import { Badge } from '@/components/ui/shadcn/badge';

type Props = {
  currentPageId: string;
  isAdmin?: boolean;
  isAuditor?: boolean;
  isResponderOrAbove?: boolean;
};

export default function SettingsPageHeader({
  currentPageId,
  isAdmin = false,
  isAuditor = false,
  isResponderOrAbove = false,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Find current page info
  const currentPage = SETTINGS_NAV_SECTIONS.flatMap(section => section.items).find(
    item => item.id === currentPageId
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Filter items based on search
  const filterItems = (items: SettingsNavItem[]) => {
    if (!searchQuery) return items;

    const query = searchQuery.toLowerCase();
    return items.filter(
      item =>
        item.label.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query) ||
        item.keywords?.some(k => k.toLowerCase().includes(query))
    );
  };

  // Check if item is accessible
  const canAccess = (item: SettingsNavItem) => {
    if (item.requiresAdmin && !isAdmin) return false;
    if (item.requiresAdminOrAuditor && !isAdmin && !isAuditor) return false;
    if (item.requiresResponder && !isResponderOrAbove) return false;
    return true;
  };

  const handleNavigate = (href: string) => {
    setIsOpen(false);
    setSearchQuery('');
    router.push(href);
  };

  return (
    <div className="settings-page-header settings-page-header-switcher">
      <div className="settings-page-header-nav">
        <div className="settings-breadcrumb">
          <span className="settings-breadcrumb-home">Settings</span>
          <span className="settings-breadcrumb-separator">›</span>

          <div className="settings-dropdown" ref={dropdownRef}>
            <button
              className="settings-dropdown-trigger"
              onClick={() => setIsOpen(!isOpen)}
              aria-expanded={isOpen}
              aria-haspopup="true"
            >
              <span>{currentPage?.label || 'Settings'}</span>
              <ChevronDown size={16} className={isOpen ? 'rotate-180' : ''} />
            </button>

            {isOpen && (
              <div className="settings-dropdown-menu">
                {/* Search */}
                <div className="settings-dropdown-search">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Jump to setting..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Navigation items grouped by section */}
                <div className="settings-dropdown-content">
                  {SETTINGS_NAV_SECTIONS.filter(section => section.id !== 'overview').map(
                    section => {
                      const filteredItems = filterItems(section.items);
                      if (filteredItems.length === 0) return null;

                      return (
                        <div key={section.id} className="settings-dropdown-section">
                          <div className="settings-dropdown-section-label">{section.label}</div>
                          {filteredItems.map(item => {
                            const isDisabled = !canAccess(item);
                            const isActive = item.id === currentPageId;

                            if (isDisabled) {
                              return (
                                <div
                                  key={item.id}
                                  className="settings-dropdown-item disabled"
                                  title="Insufficient permissions"
                                >
                                  <span className="settings-dropdown-item-label">{item.label}</span>
                                  <Badge variant="neutral" size="xs">
                                    {item.requiresAdmin
                                      ? 'Admin'
                                      : item.requiresAdminOrAuditor
                                        ? 'Admin/Auditor'
                                        : 'Responder+'}
                                  </Badge>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={item.id}
                                className={`settings-dropdown-item ${isActive ? 'active' : ''}`}
                                onClick={() => handleNavigate(item.href)}
                              >
                                <span className="settings-dropdown-item-label">{item.label}</span>
                                {isActive && (
                                  <span className="settings-dropdown-item-check">✓</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
