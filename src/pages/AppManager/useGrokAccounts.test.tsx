import React, { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api/tauri';
import { useGrokAccounts } from './useGrokAccounts';

vi.mock('../../api/tauri', () => ({
  listGrokAccounts: vi.fn(),
  startGrokLogin: vi.fn(),
  pollGrokLogin: vi.fn(),
  cancelGrokLogin: vi.fn().mockResolvedValue(undefined),
  switchGrokAccount: vi.fn(),
  deleteGrokAccount: vi.fn().mockResolvedValue(undefined),
  refreshGrokAccount: vi.fn(),
}));
vi.mock('../../hooks/useI18n', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));

describe('Grok Build account lifecycle', () => {
  const account: api.GrokAccount = {
    id: 'one',
    email: 'one@example.test',
    plan: 'SuperGrok',
    active: true,
  };
  const clearModel = vi.fn();
  const showError = vi.fn();
  let state: ReturnType<typeof useGrokAccounts>;
  let renderer: ReactTestRenderer;
  function Harness({ enabled = true, hasModel = false } = {}) {
    const result = useGrokAccounts(enabled, hasModel, clearModel, showError);
    useLayoutEffect(() => {
      state = result;
    });
    return null;
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  async function mount() {
    act(() => {
      renderer = create(<Harness />);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(api.listGrokAccounts).mockResolvedValue([account]);
    vi.mocked(api.startGrokLogin).mockResolvedValue({
      loginId: 'login',
      expiresAt: Date.now() / 1000 + 60,
    });
    vi.mocked(api.pollGrokLogin).mockResolvedValue(account);
    vi.mocked(api.refreshGrokAccount).mockResolvedValue(account);
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    vi.useRealTimers();
  });

  it('propagates a failed switch so the caller cannot continue launching', async () => {
    await mount();
    vi.mocked(api.switchGrokAccount).mockRejectedValue(new Error('accountError.write'));
    await expect(state.switchAccount()).rejects.toThrow('accountError.write');
  });
  it('keeps cached accounts without a dialog when returning to unreadable local state', async () => {
    await mount();
    act(() => renderer.update(<Harness enabled={false} />));
    vi.mocked(api.listGrokAccounts).mockRejectedValueOnce(new Error('accountError.read'));
    act(() => renderer.update(<Harness />));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(state.accounts).toEqual([account]);
    expect(showError).not.toHaveBeenCalled();
    expect(api.refreshGrokAccount).not.toHaveBeenCalled();

    vi.mocked(api.refreshGrokAccount).mockRejectedValueOnce(new Error('accountError.network'));
    await act(async () => state.refresh(account));
    expect(showError).toHaveBeenCalledWith('accountError.network');
  });
  it('cancels a login that finishes starting after leaving the tool', async () => {
    await mount();
    const waiting = deferred<api.GrokLogin>();
    vi.mocked(api.startGrokLogin).mockReturnValue(waiting.promise);
    let operation!: Promise<void>;
    act(() => {
      operation = state.add();
      renderer.update(<Harness enabled={false} />);
    });
    await act(async () => {
      waiting.resolve({ loginId: 'late', expiresAt: Date.now() / 1000 + 60 });
      await operation;
    });
    expect(api.cancelGrokLogin).toHaveBeenCalledWith('late');
    expect(api.pollGrokLogin).not.toHaveBeenCalled();
  });
  it('times out an in-flight poll and ignores its late result', async () => {
    await mount();
    const waiting = deferred<api.GrokAccount | null>();
    vi.mocked(api.pollGrokLogin).mockReturnValue(waiting.promise);
    let operation!: Promise<void>;
    await act(async () => {
      operation = state.add();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.busy).toBe(false);
    expect(api.cancelGrokLogin).toHaveBeenCalledWith('login');
    expect(showError).toHaveBeenCalledWith('accountError.expired');
    const calls = vi.mocked(api.listGrokAccounts).mock.calls.length;
    await act(async () => {
      waiting.resolve(account);
      await operation;
    });
    expect(api.listGrokAccounts).toHaveBeenCalledTimes(calls);
    expect(clearModel).not.toHaveBeenCalled();
  });
  it('keeps a model selected while login is pending and prevents duplicate login', async () => {
    await mount();
    const waiting = deferred<api.GrokAccount | null>();
    vi.mocked(api.pollGrokLogin).mockReturnValue(waiting.promise);
    let operation!: Promise<void>;
    await act(async () => {
      operation = state.add();
      await state.add();
      state.select(null);
    });
    expect(api.startGrokLogin).toHaveBeenCalledTimes(1);
    await act(async () => {
      waiting.resolve(account);
      await operation;
    });
    expect(state.selectedId).toBeNull();
    expect(clearModel).not.toHaveBeenCalled();
  });
  it('ignores a refresh response after leaving and prevents duplicate refreshes', async () => {
    await mount();
    const waiting = deferred<api.GrokAccount>();
    vi.mocked(api.refreshGrokAccount).mockReturnValue(waiting.promise);
    let operation!: Promise<void>;
    act(() => {
      operation = state.refresh(account);
    });
    await act(async () => state.refresh(account));
    expect(api.refreshGrokAccount).toHaveBeenCalledTimes(1);
    act(() => renderer.update(<Harness enabled={false} />));
    await act(async () => {
      waiting.resolve({ ...account, plan: 'Late plan' });
      await operation;
    });
    expect(state.accounts[0].plan).toBe('SuperGrok');
  });
});
