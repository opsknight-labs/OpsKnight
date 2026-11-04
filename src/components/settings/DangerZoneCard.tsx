'use client';

type Props = {
    title?: string;
    description?: string;
    children: React.ReactNode;
};

export default function DangerZoneCard({
    title = 'Danger Zone',
    description = 'These actions are destructive and cannot be undone.',
    children
}: Props) {
    return (
        <section className="settings-danger-card">
            <div className="settings-danger-header">
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
            <div className="settings-danger-body">
                {children}
            </div>
        </section>
    );
}
