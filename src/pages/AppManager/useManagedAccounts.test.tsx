import React, { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useManagedAccounts, type AccountClient, type ManagedLogin } from './useManagedAccounts';

vi.mock('../../hooks/useI18n', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));

type Account = { id: string; active?: boolean; quota?: number };
const account: Account = { id: 'saved', active: true };
const clearModel = vi.fn();
const showError = vi.fn();
let client: AccountClient<Account, ManagedLogin>;
let state: ReturnType<typeof useManagedAccounts<Account, ManagedLogin>>;
let renderer: ReactTestRenderer;

function Harness({ enabled = true, navigationKey = 'tool' }) {
  const result = useManagedAccounts(
    'store',
    enabled,
    false,
    clearModel,
    showError,
    client,
    navigationKey
  );
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
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  client = {
    list: vi.fn().mockResolvedValue([account]),
    start: vi
      .fn()
      .mockImplementation(async () => ({ loginId: 'login', expiresAt: Date.now() / 1000 + 60 })),
    cancel: vi.fn().mockResolvedValue(undefined),
    poll: vi.fn().mockResolvedValue(null),
    open: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(account),
    label: (value) => value.id,
  };
});
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  vi.useRealTimers();
});

describe('shared account request boundaries', () => {
  it.each(['refresh', 'remove'] as const)(
    'does not overwrite an explicit %s with an older account list',
    async (action) => {
      await mount();
      const stale = deferred<Account[]>();
      vi.mocked(client.list).mockReturnValueOnce(stale.promise);
      vi.mocked(client.refresh).mockResolvedValue({ ...account, quota: 42 });
      let reloading!: Promise<Account[] | undefined>;
      act(() => {
        reloading = state.reload();
      });
      await act(async () => {
        await state[action](account);
      });
      await act(async () => {
        stale.resolve([account]);
        await reloading;
      });
      expect(state.accounts).toEqual(action === 'remove' ? [] : [{ ...account, quota: 42 }]);
      expect(state.loading).toBe(false);
    }
  );

  it('keeps the latest list when concurrent reloads finish out of order', async () => {
    await mount();
    const stale = deferred<Account[]>();
    vi.mocked(client.list)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([{ ...account, quota: 9 }]);
    let earlier!: Promise<Account[] | undefined>;
    act(() => {
      earlier = state.reload();
    });
    await act(async () => {
      await state.reload();
    });
    await act(async () => {
      stale.resolve([account]);
      await earlier;
    });
    expect(state.accounts).toEqual([{ ...account, quota: 9 }]);
  });

  it('finishes a successful browser login before a slow list reload can expire it', async () => {
    await mount();
    const list = deferred<Account[]>();
    vi.mocked(client.list).mockReturnValueOnce(list.promise);
    vi.mocked(client.poll!).mockResolvedValueOnce({ id: 'new-account' });
    let adding!: Promise<void>;
    await act(async () => {
      adding = state.add();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.busy).toBe(false);
    expect(state.accounts.map((a) => a.id)).toContain('new-account');
    expect(showError).not.toHaveBeenCalled();
    await act(async () => {
      await state.remove(account);
    });
    await act(async () => {
      list.resolve([account, { id: 'new-account' }]);
      await adding;
    });
    expect(state.accounts).toEqual([{ id: 'new-account' }]);
  });

  it('times out slow initialization and cancels its late result without touching a newer attempt', async () => {
    await mount();
    const lateStart = deferred<ManagedLogin>();
    const newPoll = deferred<Account | null>();
    vi.mocked(client.start).mockReturnValueOnce(lateStart.promise);
    vi.mocked(client.poll!).mockReturnValue(newPoll.promise);
    let oldOperation!: Promise<void>;
    let newOperation!: Promise<void>;
    act(() => {
      oldOperation = state.add();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.busy).toBe(false);
    expect(showError).toHaveBeenCalledWith('accountError.expired');
    await act(async () => {
      newOperation = state.add();
    });
    await act(async () => {
      lateStart.resolve({ loginId: 'late', expiresAt: Date.now() / 1000 + 60 });
      await oldOperation;
    });
    expect(client.cancel).toHaveBeenCalledWith('late');
    expect(state.busy).toBe(true);
    expect(state.login?.loginId).toBe('login');
    expect(client.open).toHaveBeenCalledTimes(1);
    await act(async () => {
      newPoll.resolve(account);
      await newOperation;
    });
    expect(state.busy).toBe(false);
  });

  it('does not discard an independent quota refresh when login expires', async () => {
    await mount();
    const quota = deferred<Account>();
    const poll = deferred<Account | null>();
    vi.mocked(client.refresh).mockReturnValue(quota.promise);
    vi.mocked(client.poll!).mockReturnValue(poll.promise);
    let refreshing!: Promise<void>;
    let adding!: Promise<void>;
    await act(async () => {
      refreshing = state.refresh(account);
      adding = state.add();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await act(async () => {
      quota.resolve({ ...account, quota: 12 });
      poll.resolve({ id: 'late-account' });
      await Promise.all([refreshing, adding]);
    });
    expect(state.accounts).toEqual([{ ...account, quota: 12 }]);
    expect(state.refreshing.size).toBe(0);
    expect(clearModel).not.toHaveBeenCalled();
  });

  it('closes a successful manual login even if reloading saved accounts fails', async () => {
    client.complete = vi.fn().mockResolvedValue({ id: 'new-account' });
    await mount();
    await act(async () => {
      await state.add();
    });
    vi.mocked(client.list).mockRejectedValue(new Error('accountError.read'));
    await act(async () => {
      await state.completeLogin(' code ');
    });
    expect(client.complete).toHaveBeenCalledWith('login', 'code');
    expect(state.login).toBeNull();
    expect(state.busy).toBe(false);
    expect(state.loginError).toBeNull();
    expect(state.accounts.map((a) => a.id)).toContain('new-account');
    expect(state.selectedId).toBe('new-account');
    expect(showError).toHaveBeenCalledWith('accountError.read');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(showError).toHaveBeenCalledTimes(1);
  });

  it('keeps manual authorization errors retryable and ignores completion after leaving', async () => {
    client.complete = vi.fn().mockRejectedValueOnce(new Error('accountError.auth'));
    await mount();
    await act(async () => {
      await state.add();
      await state.completeLogin('bad');
    });
    expect(state.loginError).toBe('accountError.auth');
    expect(state.login?.loginId).toBe('login');
    const completion = deferred<Account>();
    vi.mocked(client.complete).mockReturnValue(completion.promise);
    let submitting!: Promise<void>;
    await act(async () => {
      submitting = state.completeLogin('good');
    });
    act(() => {
      renderer.update(<Harness enabled={false} />);
    });
    await act(async () => {
      completion.resolve({ id: 'late-account' });
      await submitting;
    });
    expect(client.cancel).toHaveBeenCalledWith('login');
    expect(client.list).toHaveBeenCalledTimes(1);
    expect(clearModel).not.toHaveBeenCalled();
    expect(state.accounts).toEqual([account]);
  });

  it('preserves cached rows on navigation failure without quota, login or dialogs', async () => {
    await mount();
    vi.mocked(client.list).mockRejectedValue(new Error('accountError.read'));
    act(() => {
      renderer.update(<Harness navigationKey="other-tool-sharing-store" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state.accounts).toEqual([account]);
    expect(client.start).not.toHaveBeenCalled();
    expect(client.refresh).not.toHaveBeenCalled();
    expect(client.remove).not.toHaveBeenCalled();
    expect(client.open).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });
});
