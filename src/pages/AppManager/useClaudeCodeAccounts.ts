import { accountError } from '../../utils/accountError';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../api/tauri';
import type { ClaudeCodeAccount } from '../../api/tauri';
import { useConfirm } from '../../components/ConfirmDialog';
import { useI18n } from '../../hooks/useI18n';

export function useClaudeCodeAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (error: string) => void
) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<ClaudeCodeAccount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const refreshingRef = useRef(new Set<string>());
  const addingRef = useRef(false);
  const loginGeneration = useRef(0);
  const navigationGeneration = useRef(0);
  const selectionRevision = useRef(0);
  const loginSelectionRevision = useRef(0);
  const loginDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasModelRef = useRef(hasModel);
  useEffect(() => {
    hasModelRef.current = hasModel;
  }, [hasModel]);
  const [login, setLogin] = useState<api.ClaudeCodeLogin | null>(null);
  const loginRef = useRef<api.ClaudeCodeLogin | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const cancelLogin = useCallback(() => {
    const pending = loginRef.current;
    if (loginDeadline.current) clearTimeout(loginDeadline.current);
    loginDeadline.current = null;
    const generation = ++loginGeneration.current;
    loginRef.current = null;
    setLogin(null);
    setBusy(false);
    setLoginError(null);
    addingRef.current = false;
    submittingRef.current = null;
    setSubmitting(false);
    if (pending)
      void api.cancelClaudeCodeLogin(pending.loginId).catch((error) => {
        if (generation === loginGeneration.current) showError(accountError(error, t));
      });
  }, [showError, t]);

  useEffect(() => {
    if (!login) return;
    const update = () => {
      const seconds = Math.max(0, Math.ceil(login.expiresAt - Date.now() / 1000));
      setRemainingSeconds(seconds);
      if (!seconds) cancelLogin();
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [login, cancelLogin]);

  const reload = useCallback(async () => {
    const generation = navigationGeneration.current;
    const result = await api.listClaudeCodeAccounts();
    if (generation === navigationGeneration.current) setAccounts(result);
    return result;
  }, []);

  useEffect(() => {
    const generation = ++navigationGeneration.current;
    const revision = selectionRevision.current;
    const timer = setTimeout(() => {
      setBusy(false);
      setLogin(null);
      setSubmitting(false);
      setLoginError(null);
      setRefreshing(new Set());
      if (!enabled) return;
      void api
        .listClaudeCodeAccounts()
        .then((result) => {
          if (generation !== navigationGeneration.current) return;
          setAccounts(result);
          if (!hasModelRef.current && revision === selectionRevision.current) {
            setSelectedId((id) =>
              result.some((account) => account.id === id)
                ? id
                : (result.find((account) => account.active)?.id ?? null)
            );
          }
        })
        .catch(() => {});
    }, 0);
    return () => {
      clearTimeout(timer);
      navigationGeneration.current += 1;
      loginGeneration.current += 1;
      addingRef.current = false;
      submittingRef.current = null;
      refreshingRef.current = new Set();
      if (loginDeadline.current) clearTimeout(loginDeadline.current);
      loginDeadline.current = null;
      const pending = loginRef.current;
      loginRef.current = null;
      if (pending) void api.cancelClaudeCodeLogin(pending.loginId).catch(() => {});
    };
  }, [enabled]);

  const select = (id: string | null) => {
    selectionRevision.current += 1;
    setSelectedId(id);
    if (id) clearModel();
  };

  const refresh = async (account: ClaudeCodeAccount) => {
    const requests = refreshingRef.current;
    if (!enabled || requests.has(account.id)) return;
    const generation = navigationGeneration.current;
    requests.add(account.id);
    setRefreshing(new Set(requests));
    try {
      const updated = await api.refreshClaudeCodeAccountQuota(account.id);
      if (generation !== navigationGeneration.current) return;
      setAccounts((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      if (generation === navigationGeneration.current) showError(accountError(error, t));
    } finally {
      requests.delete(account.id);
      if (generation === navigationGeneration.current) setRefreshing(new Set(requests));
    }
  };

  const add = async () => {
    if (!enabled || addingRef.current) return;
    addingRef.current = true;
    const generation = ++loginGeneration.current;
    loginSelectionRevision.current = selectionRevision.current;
    setBusy(true);
    setLoginError(null);
    loginDeadline.current = setTimeout(() => {
      if (generation !== loginGeneration.current) return;
      cancelLogin();
      showError(t('accountError.expired'));
    }, 60_000);
    try {
      const pending = await api.startClaudeCodeLogin();
      if (generation !== loginGeneration.current) {
        await api.cancelClaudeCodeLogin(pending.loginId);
        return;
      }
      loginRef.current = pending;
      setRemainingSeconds(Math.max(0, Math.ceil(pending.expiresAt - Date.now() / 1000)));
      setLogin(pending);
      await shellOpen(pending.authorizationUrl);
    } catch (error) {
      if (generation === loginGeneration.current) {
        cancelLogin();
        showError(accountError(error, t));
      }
    }
  };

  const completeLogin = async (code: string) => {
    const pending = loginRef.current;
    if (!pending || submittingRef.current === pending.loginId) return;
    submittingRef.current = pending.loginId;
    setSubmitting(true);
    setLoginError(null);
    try {
      const account = await api.completeClaudeCodeLogin(pending.loginId, code.trim());
      if (loginRef.current?.loginId !== pending.loginId) return;
      if (loginDeadline.current) clearTimeout(loginDeadline.current);
      loginDeadline.current = null;
      loginRef.current = null;
      setLogin(null);
      setBusy(false);
      addingRef.current = false;
      if (loginSelectionRevision.current === selectionRevision.current) select(account.id);
      const generation = navigationGeneration.current;
      await reload().catch((error) => {
        if (generation === navigationGeneration.current) showError(accountError(error, t));
      });
    } catch (error) {
      if (loginRef.current?.loginId === pending.loginId) setLoginError(accountError(error, t));
    } finally {
      if (submittingRef.current === pending.loginId) {
        submittingRef.current = null;
        setSubmitting(false);
      }
    }
  };

  const remove = async (account: ClaudeCodeAccount) => {
    const generation = navigationGeneration.current;
    if (
      !(await confirm({
        title: t('agent.deleteAccountTitle'),
        message: t('agent.deleteAccountConfirm').replace('{email}', account.email),
        confirmText: t('btn.delete'),
        type: 'danger',
      }))
    )
      return;
    if (generation !== navigationGeneration.current) return;
    try {
      await api.deleteClaudeCodeAccount(account.id);
      if (generation !== navigationGeneration.current) return;
      setSelectedId((id) => (id === account.id ? null : id));
      await reload();
    } catch (error) {
      if (generation === navigationGeneration.current) showError(accountError(error, t));
    }
  };

  return {
    login: enabled ? login : null,
    remainingSeconds,
    submitting,
    loginError,
    cancelLogin,
    completeLogin,
    accounts,
    selectedId: enabled && !hasModel ? selectedId : null,
    setSelectedId: select,
    select,
    busy,
    refreshing,
    add,
    refresh,
    remove,
    reload,
  };
}
