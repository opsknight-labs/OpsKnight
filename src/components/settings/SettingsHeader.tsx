type Props = {
    title: string;
    description?: string;
    learnMoreHref?: string;
    learnMoreLabel?: string;
    backHref?: string;
    backLabel?: string;
};

export default function SettingsHeader({
    title,
    description,
    learnMoreHref,
    learnMoreLabel = 'Learn more',
    backHref,
    backLabel = 'Back to Settings'
}: Props) {
    return (
        <header className="settings-page-header">
            <div>
                {backHref && (
                    <a className="settings-back-link" href={backHref}>
                        {backLabel}
                    </a>
                )}
                <h1>{title}</h1>
                {description && <p>{description}</p>}
            </div>
            {learnMoreHref && (
                <a className="settings-learn-more" href={learnMoreHref} target="_blank" rel="noreferrer">
                    {learnMoreLabel}
                </a>
            )}
        </header>
    );
}
