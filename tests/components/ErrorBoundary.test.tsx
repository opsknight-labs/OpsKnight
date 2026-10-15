import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '@/components/ui/ErrorBoundary';

const ThrowError = ({ error }: { error: Error }) => {
  throw error;
};

describe('ErrorBoundary', () => {
  const originalLocation = window.location;
  const reloadMock = vi.fn();

  beforeEach(() => {
    reloadMock.mockClear();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: reloadMock,
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Content loaded successfully</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Content loaded successfully')).toBeInTheDocument();
  });

  it('renders application update prompt and triggers reload on ChunkLoadError', () => {
    const chunkError = new Error('ChunkLoadError: Loading chunk 92296 failed');
    chunkError.name = 'ChunkLoadError';

    render(
      <ErrorBoundary>
        <ThrowError error={chunkError} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Application Update Available')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A new version of OpsKnight has been deployed. Please reload the page to get the latest updates.'
      )
    ).toBeInTheDocument();

    const reloadBtn = screen.getByRole('button', { name: /reload application/i });
    expect(reloadBtn).toBeInTheDocument();
    fireEvent.click(reloadBtn);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('renders generic fallback and retry button for regular errors', () => {
    const regularError = new Error('Database connection failed');

    render(
      <ErrorBoundary>
        <ThrowError error={regularError} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
