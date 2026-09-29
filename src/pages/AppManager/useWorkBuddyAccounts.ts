import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import { accountError } from '../../utils/accountError';
import { useI18n } from '../../hooks/useI18n';
import { useConfirm } from '../../components/ConfirmDialog';

export function useWorkBuddyAccounts(
  edition: api.WorkBuddyEdition | null,
  hasModel: boolean,
  clearModel: (edition: api.WorkBuddyEdition) => void,
  showError: (error: string) => void
) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accountsByEdition, setAccountsByEdition] = useState<
    Partial<Record<api.WorkBuddyEdition, api.WorkBuddyAccount[]>>
  >({});
  const [selected, setSelected] = useState<Partial<Record<api.WorkBuddyEdition, string | null>>>(
    {}
  );
  const [busy, setBusy] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const refreshingRef = useRef(new Set<string>());
  const generation = useRef(0);
  const adding = useRef(false);
  const pending = useRef<api.WorkBuddyLogin | null>(null);
  const clearLoginTimers = useRef<(() => void) | null>(null);
  const selectionRevision = useRef(0);
  const hasModelRef = useRef(hasModel);
  useEffect(() => {
    hasModelRef.current = hasModel;
  }, [hasModel]);
  const selectedId = edition && !hasModel ? (selected[edition] ?? null) : null;

  const reload = useCallback(async () => {
    if (!edition) return;
    const current = generation.current;
    const result = await api.listWorkBuddyAccounts(edition);
    if (current === generation.current)
      setAccountsByEdition((prev) => ({ ...prev, [edition]: result }));
  }, [edition]);

  const refresh = useCallback(
    async (account: api.WorkBuddyAccount) => {
      const requests = refreshingRef.current;
      if (!edition || requests.has(account.id)) return;
      const current = generation.current;
      requests.add(account.id);
      setRefreshing(new Set(requests));
      try {
        const updated = await api.refreshWorkBuddyAccountQuota(account.edition, account.id);
        if (current !== generation.current) return;
        setAccountsByEdition((prev) => ({
          ...prev,
          [updated.edition]: (prev[updated.edition] ?? []).map((a) =>
            a.id === updated.id ? updated : a
          ),
        }));
      } catch (error) {
        if (current === generation.current) showError(accountError(error, t));
      } finally {
        requests.delete(account.id);
        if (requests === refreshingRef.current) setRefreshing(new Set(requests));
      }
    },
    [edition, showError, t]
  );

  useEffect(() => {
    const current = ++generation.current;
    const revision = selectionRevision.current;
    const timer = setTimeout(() => {
      setBusy(false);
      setRefreshing(new Set());
      if (!edition) return;
      void api
        .listWorkBuddyAccounts(edition)
        .then((result) => {
          if (current !== generation.current) return;
          setAccountsByEdition((prev) => ({ ...prev, [edition]: result }));
          if (!hasModelRef.current && revision === selectionRevision.current)
            setSelected((prev) => ({
              ...prev,
              [edition]: result.some((a) => a.id === prev[edition])
                ? prev[edition]
                : (result.find((a) => a.active)?.id ?? null),
            }));
        })
        .catch(() => {});
    }, 0);
    return () => {
      clearTimeout(timer);
      generation.current += 1;
      adding.current = false;
      refreshingRef.current = new Set();
      clearLoginTimers.current?.();
      clearLoginTimers.current = null;
      const login = pending.current;
      pending.current = null;
      if (login) void api.cancelWorkBuddyLogin(login.loginId).catch(() => {});
    };
  }, [edition]);

  const select = (id: string | null) => {
    if (!edition) return;
    selectionRevision.current += 1;
    setSelected((prev) => ({ ...prev, [edition]: id }));
    if (id) clearModel(edition);
  };
  const add = async () => {
    if (!edition || adding.current) return;
    const current = generation.current;
    const revision = selectionRevision.current;
    adding.current = true;
    setBusy(true);
    setRemainingSeconds(60);
    let login: api.WorkBuddyLogin | null = null;
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
      if (login) void api.cancelWorkBuddyLogin(login.loginId).catch(() => {});
      showError(t('accountError.expired'));
    }, 60_000);
    const clearTimers = () => {
      clearTimeout(deadline);
      clearInterval(ticker);
    };
    clearLoginTimers.current = clearTimers;
    try {
      login = await api.startWorkBuddyLogin(edition);
      if (current !== generation.current) return;
      pending.current = login;
      const expires = Math.min(login.expiresAt, Date.now() / 1000 + 60);
      setRemainingSeconds(Math.max(0, Math.ceil(expires - Date.now() / 1000)));
      ticker = setInterval(() => {
        if (current === generation.current)
          setRemainingSeconds(Math.max(0, Math.ceil(expires - Date.now() / 1000)));
      }, 250);
      await api.openExternal(login.verificationUri);
      while (current === generation.current && Date.now() / 1000 < expires) {
        const account = await api.pollWorkBuddyLogin(login.loginId);
        if (current !== generation.current) return;
        if (account) {
          pending.current = null;
          await reload();
          if (current !== generation.current) return;
          if (revision === selectionRevision.current) select(account.id);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (current === generation.current) throw new Error('accountError.expired');
    } catch (error) {
      if (current === generation.current) showError(accountError(error, t));
    } finally {
      clearTimers();
      if (clearLoginTimers.current === clearTimers) clearLoginTimers.current = null;
      if (login) void api.cancelWorkBuddyLogin(login.loginId).catch(() => {});
      if (current === generation.current) {
        pending.current = null;
        adding.current = false;
        setBusy(false);
      }
    }
  };
  const remove = async (account: api.WorkBuddyAccount) => {
    const current = generation.current;
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        confirmText: t('btn.delete'),
        type: 'danger',
        message: t('agent.deleteAccountConfirm').replace('{email}', account.name),
      }))
    )
      return;
    if (current !== generation.current) return;
    try {
      await api.deleteWorkBuddyAccount(account.edition, account.id);
      setAccountsByEdition((prev) => ({
        ...prev,
        [account.edition]: (prev[account.edition] ?? []).filter((a) => a.id !== account.id),
      }));
      setSelected((prev) => ({
        ...prev,
        [account.edition]: prev[account.edition] === account.id ? null : prev[account.edition],
      }));
      if (current === generation.current) await reload();
    } catch (error) {
      if (current === generation.current) showError(accountError(error, t));
    }
  };
  return {
    accounts: edition ? (accountsByEdition[edition] ?? []) : [],
    selectedId,
    select,
    busy,
    remainingSeconds,
    refreshing,
    add,
    refresh,
    remove,
    reload,
  };
}
