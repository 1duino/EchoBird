import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { accountError } from '../../utils/accountError';
import { useI18n } from '../../hooks/useI18n';
import { useConfirm } from '../../components/ConfirmDialog';

const accountClients = {
  grok: {
    list: api.listGrokAccounts,
    start: api.startGrokLogin,
    poll: api.pollGrokLogin,
    cancel: api.cancelGrokLogin,
    remove: api.deleteGrokAccount,
    switch: api.switchGrokAccount,
    refresh: api.refreshGrokAccount,
  },
  manus: {
    list: api.listManusAccounts,
    start: api.startManusLogin,
    poll: api.pollManusLogin,
    cancel: api.cancelManusLogin,
    remove: api.deleteManusAccount,
    switch: api.switchManusAccount,
    refresh: api.refreshManusAccount,
  },
};

export function useGrokAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (e: string) => void,
  tool: 'grok' | 'manus' = 'grok'
) {
  const client = accountClients[tool];
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<(api.GrokAccount | api.ManusAccount)[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const pending = useRef<api.GrokLogin | api.ManusLogin | null>(null);
  const generation = useRef(0);
  const adding = useRef(false);
  const selectionRevision = useRef(0);
  const clearLoginTimers = useRef<(() => void) | null>(null);
  const refreshRequests = useRef(new Map<string, symbol>());
  const hasModelRef = useRef(hasModel);
  useEffect(() => {
    hasModelRef.current = hasModel;
  }, [hasModel]);
  const reload = useCallback(async () => {
    const current = generation.current;
    const result = await client.list();
    if (current !== generation.current) return;
    setAccounts(result);
    return result;
  }, [client]);
  useEffect(() => {
    const g = ++generation.current;
    const revision = selectionRevision.current;
    const requests = refreshRequests.current;
    const timer = setTimeout(() => {
      setBusy(false);
      setRefreshing(new Set());
      if (!enabled) return;
      void reload()
        .then((result) => {
          if (
            result &&
            g === generation.current &&
            !hasModelRef.current &&
            revision === selectionRevision.current
          )
            setSelectedId((id) =>
              result.some((a) => a.id === id) ? id : (result.find((a) => a.active)?.id ?? null)
            );
        })
        .catch(() => {
          // Keep cached accounts while browsing if local state cannot be read.
          // Explicit account actions still report failures.
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      adding.current = false;
      requests.clear();
      clearLoginTimers.current?.();
      clearLoginTimers.current = null;
      const p = pending.current;
      pending.current = null;
      if (p) void client.cancel(p.loginId).catch(() => {});
    };
  }, [enabled, reload, client]);
  const select = (id: string | null) => {
    selectionRevision.current += 1;
    setSelectedId(id);
    if (id) clearModel();
  };
  const add = async () => {
    if (!enabled || adding.current) return;
    const current = generation.current;
    const revision = selectionRevision.current;
    adding.current = true;
    setBusy(true);
    setRemainingSeconds(60);
    let login: api.GrokLogin | api.ManusLogin | null = null;
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
      if (login?.loginId) void client.cancel(login.loginId).catch(() => {});
      showError(t('accountError.expired'));
    }, 60_000);
    const clearTimers = () => {
      clearTimeout(deadline);
      clearInterval(ticker);
    };
    clearLoginTimers.current = clearTimers;
    try {
      login = await client.start();
      if (current !== generation.current) {
        if (login.loginId) await client.cancel(login.loginId);
        return;
      }
      const captured = tool === 'manus' ? (login as api.ManusLogin).account : null;
      if (captured) {
        await reload();
        if (current === generation.current && revision === selectionRevision.current)
          select(captured.id);
        return;
      }
      pending.current = login;
      if ('verificationUri' in login && typeof login.verificationUri === 'string')
        await api.openExternal(login.verificationUri);
      const expires = Math.min(login.expiresAt, Date.now() / 1000 + 60);
      ticker = setInterval(() => {
        if (current === generation.current)
          setRemainingSeconds(Math.max(0, Math.ceil(expires - Date.now() / 1000)));
      }, 250);
      while (current === generation.current && Date.now() / 1000 < expires) {
        const a = await client.poll(login.loginId);
        if (current !== generation.current) return;
        if (a) {
          pending.current = null;
          await reload();
          if (current === generation.current && revision === selectionRevision.current)
            select(a.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (current === generation.current) throw new Error('accountError.expired');
    } catch (e) {
      if (current === generation.current) showError(accountError(e, t));
    } finally {
      clearTimers();
      if (clearLoginTimers.current === clearTimers) clearLoginTimers.current = null;
      if (login?.loginId) void client.cancel(login.loginId).catch(() => {});
      if (current === generation.current) {
        pending.current = null;
        adding.current = false;
        setBusy(false);
        setRemainingSeconds(0);
      }
    }
  };
  const remove = async (a: api.GrokAccount) => {
    const current = generation.current;
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        message: t('agent.deleteAccountConfirm').replace('{email}', a.email),
        confirmText: t('btn.delete'),
        type: 'danger',
      }))
    )
      return;
    if (current !== generation.current) return;
    try {
      await client.remove(a.id);
      if (current !== generation.current) return;
      setAccounts((prev) => prev.filter((account) => account.id !== a.id));
      setSelectedId((id) => (id === a.id ? null : id));
    } catch (e) {
      if (current === generation.current) showError(accountError(e, t));
    }
  };
  const switchAccount = async () => {
    if (!selectedId) return;
    await client.switch(selectedId);
    await reload();
  };
  const refresh = async (account: api.GrokAccount) => {
    if (!enabled || refreshRequests.current.has(account.id)) return;
    const current = generation.current;
    const request = Symbol();
    refreshRequests.current.set(account.id, request);
    setRefreshing(new Set(refreshRequests.current.keys()));
    try {
      const updated = await client.refresh(account.id);
      if (current === generation.current)
        setAccounts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      if (current === generation.current) showError(accountError(e, t));
    } finally {
      if (refreshRequests.current.get(account.id) === request) {
        refreshRequests.current.delete(account.id);
        setRefreshing(new Set(refreshRequests.current.keys()));
      }
    }
  };
  return {
    accounts,
    selectedId: enabled && !hasModel ? selectedId : null,
    select,
    busy,
    remainingSeconds,
    add,
    remove,
    switchAccount,
    refresh,
    refreshing,
    reload,
  };
}
