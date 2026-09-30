import * as api from '../../api/tauri';
import { useI18n } from '../../hooks/useI18n';
import { useManagedAccounts } from './useManagedAccounts';

export function useCodexAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (error: string) => void,
  navigationKey: string
) {
  const { t } = useI18n();
  return useManagedAccounts(
    'codex',
    enabled,
    hasModel,
    clearModel,
    showError,
    {
      list: api.listCodexAccounts,
      start: async () => ({
        loginId: await api.startCodexLogin(),
        expiresAt: Date.now() / 1000 + 60,
      }),
      // The native OAuth callback waits for completion and opens its own browser.
      poll: (id) =>
        api.addCodexAccountViaOAuth(id, {
          complete: t('accountError.complete'),
          closeWindow: t('accountError.closeWindow'),
          failed: t('accountError.callbackFailed'),
        }),
      cancel: api.cancelCodexLogin,
      remove: (account) => api.deleteCodexAccount(account.id),
      refresh: (account) => api.refreshCodexAccountQuota(account.id),
      label: (account) => account.email,
      refreshLimit: 5,
      refreshError: (account, message) =>
        t('agent.refreshAccountFailed')
          .replace('{email}', account.email)
          .replace('{error}', message),
    },
    navigationKey
  );
}
