'use client';

import { useState } from 'react';
import './NotificationProviderTabs.css';

type TabId = 'sms' | 'push' | 'whatsapp';

type Props = {
    children: React.ReactNode;
    defaultTab?: TabId;
};

export default function NotificationProviderTabs({ children, defaultTab = 'sms' }: Props) {
    const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

    const tabs = [
        { id: 'sms' as const, label: 'SMS (Twilio)' },
        { id: 'push' as const, label: 'Push Notifications' },
        { id: 'whatsapp' as const, label: 'WhatsApp Business' }
    ];

    return (
        <div className="notification-provider-tabs">
            <div className="notification-tabs-header">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`notification-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                        aria-selected={activeTab === tab.id}
                        role="tab"
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="notification-tabs-content" data-active-tab={activeTab}>
                {children}
            </div>
        </div>
    );
}
