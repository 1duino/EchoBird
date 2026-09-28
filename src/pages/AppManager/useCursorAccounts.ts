import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { accountError } from '../../utils/accountError';
import { useI18n } from '../../hooks/useI18n';
import { useConfirm } from '../../components/ConfirmDialog';

const clients = {
  grokbot: {
    list: api.listGrokBotAccounts,
    start: api.startGrokBotLogin,
    poll: api.pollGrokBotLogin,
    cancel: api.cancelGrokBotLogin,
    remove: api.deleteGrokBotAccount,
    refresh: api.refreshGrokBotAccount,
  },
  cursor: {
    list: api.listCursorAccounts,
    start: api.startCursorLogin,
    poll: api.pollCursorLogin,
    cancel: api.cancelCursorLogin,
    remove: api.deleteCursorAccount,
    refresh: api.refreshCursorAccount,
  },
};

export function useCursorAccounts(
  tool: 'cursor' | 'grokbot',
  enabled: boolean,
  clearModel: () => void,
  showError: (error: string) => void
) {
  const client = clients[tool];
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<api.CursorAccount[]>([]);
  const [selectedId, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const generation = useRef(0);
  const selectionRevision = useRef(0);
  const adding = useRef(false);
  const pending = useRef<api.CursorLogin | null>(null);
  const clearLoginTimers = useRef<(() => void) | null>(null);
  const refreshRequests = useRef(new Map<string, symbol>());
  const [refreshing, setRefreshing] = useState(new Set<string>());

  const refresh = useCallback(
    async (account: api.CursorAccount) => {
      if (!enabled || refreshRequests.current.has(account.id)) return;
      const current = generation.current;
      const request = Symbol();
      refreshRequests.current.set(account.id, request);
      setRefreshing(new Set(refreshRequests.current.keys()));
      try {
        const usage = await client.refresh(account.id);
        if (current === generation.current) {
          setAccounts((prev) =>
            prev.map((item) => (item.id === account.id ? { ...item, usage } : item))
          );
        }
      } catch (error) {
        if (current === generation.current) showError(accountError(error, t));
      } finally {
        if (refreshRequests.current.get(account.id) === request) {
          refreshRequests.current.delete(account.id);
          setRefreshing(new Set(refreshRequests.current.keys()));
        }
      }
    },
    [client, enabled, showError, t]
  );

  const reload = useCallback(async () => {
    const current = generation.current;
    const result = await client.list();
    if (current === generation.current) setAccounts(result);
  }, [client]);

  useEffect(() => {
    const current = ++generation.current;
    const revision = selectionRevision.current;
    const requests = refreshRequests.current;
    const timer = setTimeout(() => {
      setBusy(false);
      setRefreshing(new Set());
      if (!enabled) return;
      void client
        .list()
        .then((result) => {
          if (current !== generation.current) return;
          setAccounts(result);
          if (revision === selectionRevision.current)
            setSelected((prev) =>
              result.some((a) => a.id === prev) ? prev : (result.find((a) => a.active)?.id ?? null)
            );
        })
        .catch(() => {
          // Client files may be absent or temporarily unreadable. Keep cached
          // accounts while browsing; explicit account actions report failures.
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      adding.current = false;
      requests.clear();
      clearLoginTimers.current?.();
      clearLoginTimers.current = null;
      const login = pending.current;
      pending.current = null;
      if (login) void client.cancel(login.loginId).catch(() => {});
    };
  }, [client, enabled]);

  const select = (id: string | null) => {
    selectionRevision.current += 1;
    setSelected(id);
    if (id) clearModel();
  };

  const add = async () => {
    if (!enabled || adding.current) return;
    const current = generation.current;
    const revision = selectionRevision.current;
    adding.current = true;
    setBusy(true);
    setRemainingSeconds(60);
    let login: api.CursorLogin | null = null;
    let ticker: ReturnType<typeof setInterval> | undefined;
    const deadline = setTimeout(() => {
      if (current !== generation.current) return;
      generation.current += 1;
      adding.current = false;
      clearInterval(ticker);
      clearLoginTimers.current = null;
      pending.current = null;
      setBusy(false);
      setRemainingSeconds(0);
      if (login) void client.cancel(login.loginId).catch(() => {});
      showError(t('accountError.expired'));
    }, 60_000);
    const clearTimers = () => {
      clearTimeout(deadline);
      clearInterval(ticker);
    };
    clearLoginTimers.current = clearTimers;
    try {
      login = await client.start();
      if (current !== generation.current) return;
      pending.current = login;
      const expires = Math.min(login.expiresAt, Date.now() / 1000 + 60);
      ticker = setInterval(() => {
        if (current === generation.current)
          setRemainingSeconds(Math.max(0, Math.ceil(expires - Date.now() / 1000)));
      }, 250);
      await api.openExternal(login.verificationUri);
      while (current === generation.current && Date.now() / 1000 < expires) {
        const account = await client.poll(login.loginId);
        if (current !== generation.current) return;
        if (account) {
          pending.current = null;
          await reload();
          if (current === generation.current && revision === selectionRevision.current)
            select(account.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (current === generation.current) throw new Error('accountError.expired');
    } catch (error) {
      if (current === generation.current) showError(accountError(error, t));
    } finally {
      clearTimers();
      if (clearLoginTimers.current === clearTimers) clearLoginTimers.current = null;
      if (login) void client.cancel(login.loginId).catch(() => {});
      if (current === generation.current) {
        pending.current = null;
        adding.current = false;
        setBusy(false);
      }
    }
  };

  const remove = async (account: api.CursorAccount) => {
    const current = generation.current;
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        confirmText: t('btn.delete'),
        type: 'danger',
        message: t('agent.deleteAccountConfirm').replace('{email}', account.email),
      }))
    )
      return;
    if (current !== generation.current) return;
    try {
      await client.remove(account.id);
      if (current !== generation.current) return;
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setSelected((prev) => (prev === account.id ? null : prev));
    } catch (error) {
      if (current === generation.current) showError(accountError(error, t));
    }
  };
  return {
    accounts,
    selectedId: enabled ? selectedId : null,
    select,
    busy,
    remainingSeconds,
    refreshing,
    refresh,
    add,
    remove,
    reload,
  };
}
