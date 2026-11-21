import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SquireMarkdown from '@/components/squire/SquireMarkdown';

describe('Squire answer formatting', () => {
  it('renders headings, lists, tables and code without fetching images or activating uncited links', () => {
    const { container } = render(
      <SquireMarkdown
        allowed={['/incidents/known']}
        text={
          '## Findings\n\n**Pool exhausted**\n\n- Check connections\n\n| Metric | Value |\n| --- | --- |\n| Active | 200 |\n\n[Evidence](/incidents/known) [Fake](/incidents/invented) [Outside](https://evil.example)\n\n![tracking](https://evil.example/pixel)\n\n<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n```sh\necho "<safe>"\n```'
        }
      />
    );
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/incidents/known');
    expect(container.querySelector('img, script')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(container.querySelector('pre')).toHaveTextContent('echo "<safe>"');
  });
  it('copies the exact code as text and renders only server-cited bare paths as links', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(
      <SquireMarkdown
        allowed={['/runbooks/safe']}
        text={'Read /runbooks/safe and /incidents/unknown\n\n```sh\nprintf "ok"\n```'}
      />
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await screen.findByText('Code copied');
    expect(writeText).toHaveBeenCalledWith('printf "ok"');
  });
});
