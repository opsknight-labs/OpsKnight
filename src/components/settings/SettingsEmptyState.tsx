'use client';

type Props = {
    title: string;
    description: string;
    action?: React.ReactNode;
};

export default function SettingsEmptyState({ title, description, action }: Props) {
    return (
        <div className="settings-empty-state-v2">
            <div className="settings-empty-icon">o</div>
            <h3>{title}</h3>
            <p>{description}</p>
            {action && <div className="settings-empty-action">{action}</div>}
        </div>
    );
}
