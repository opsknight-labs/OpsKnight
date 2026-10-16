import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionOutputViewer } from '@/components/runbooks/executions/ExecutionOutputViewer';

describe('ExecutionOutputViewer', () => {
  it('renders monospace output with wrap toggle, copy and artifact download', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <ExecutionOutputViewer
        label="Step output"
        output="line one"
        artifactId="art_1"
        canDownloadArtifacts
      />
    );

    const pre = screen.getByLabelText('Step output', { selector: 'pre' });
    expect(pre).toHaveTextContent('line one');
    expect(pre.className).toContain('whitespace-pre-wrap');

    const wrap = screen.getByRole('button', { name: 'Wrap lines' });
    expect(wrap).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(wrap);
    expect(wrap).toHaveAttribute('aria-pressed', 'false');
    expect(pre.className).not.toContain('whitespace-pre-wrap');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy step output' }));
    });
    expect(writeText).toHaveBeenCalledWith('line one');
    expect(screen.getByText('Copied')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Download sanitized output' })).toHaveAttribute(
      'href',
      '/api/runbook-artifacts/art_1'
    );
  });

  it('hides sensitive artifact downloads without the download capability', () => {
    render(<ExecutionOutputViewer label="Step output" output="x" artifactId="art_1" />);
    expect(screen.queryByRole('link', { name: 'Download sanitized output' })).toBeNull();
  });

  it('omits the download link without an artifact', () => {
    render(<ExecutionOutputViewer label="Step output" output="x" />);
    expect(screen.queryByRole('link', { name: 'Download sanitized output' })).toBeNull();
  });
});
