'use client';

import { openSquire } from '@/components/squire/SquireLauncher';
import SquireAvatar, { type SquireAvatarKind } from '@/components/squire/SquireAvatar';

const QUESTIONS = ['Summarise this incident', 'Have we seen this before?', 'What could have caused this?', 'Which runbook fits?'];

export default function AskSquirePanel({ name, avatar }: { name: string; avatar: SquireAvatarKind }) {
  return (
    <section aria-labelledby="ask-squire-heading" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <SquireAvatar kind={avatar} size="md" />
        <div>
          <h2 id="ask-squire-heading" className="text-sm font-semibold">
            Ask {name}
          </h2>
          <p className="text-xs text-muted-foreground">Answers use only what you can already see. Nothing is changed.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map(question => (
          <button
            key={question}
            type="button"
            onClick={() => openSquire(question)}
            className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}
