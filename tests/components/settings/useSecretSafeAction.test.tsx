import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSecretSafeAction } from '@/components/settings/useSecretSafeAction';

type State = { error: string | null; success: boolean; token: string | null };

describe('useSecretSafeAction', () => {
  it('passes the secret to the callback and never keeps it in the action state', async () => {
    const onSecret = vi.fn();
    const action = vi.fn(async (_prev: State): Promise<State> => ({
      error: null,
      success: true,
      token: 'ok_test_one_time_secret',
    }));
    const { result } = renderHook(() =>
      useSecretSafeAction<State>(action, { error: null, success: false, token: null }, onSecret)
    );

    await act(async () => {
      result.current[1](new FormData());
    });

    expect(onSecret).toHaveBeenCalledWith('ok_test_one_time_secret');
    expect(result.current[0].success).toBe(true);
    expect(result.current[0].token).toBeNull();
    expect(JSON.stringify(result.current[0])).not.toContain('ok_test_one_time_secret');
  });

  it('passes errors through untouched and does not invoke the callback', async () => {
    const onSecret = vi.fn();
    const action = vi.fn(async (): Promise<State> => ({
      error: 'Not allowed',
      success: false,
      token: null,
    }));
    const { result } = renderHook(() =>
      useSecretSafeAction<State>(action, { error: null, success: false, token: null }, onSecret)
    );
    await act(async () => {
      result.current[1](new FormData());
    });
    expect(result.current[0].error).toBe('Not allowed');
    expect(onSecret).not.toHaveBeenCalled();
  });
});
