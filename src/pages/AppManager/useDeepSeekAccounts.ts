import * as api from '../../api/tauri';
import { useI18n } from '../../hooks/useI18n';
import { useManagedAccounts } from './useManagedAccounts';

export function useDeepSeekAccounts(
  enabled: boolean,
  hasModel: boolean,
  clearModel: () => void,
  showError: (error: string) => void
) {
  const { locale } = useI18n();
  return useManagedAccounts<api.DeepSeekAccount, api.DeepSeekLogin>(
    'dsh',
    enabled,
    hasModel,
    clearModel,
    showError,
    {
      list: api.listDeepSeekAccounts,
      start: () => api.startDeepSeekLogin(locale),
      poll: api.pollDeepSeekLogin,
      cancel: api.cancelDeepSeekLogin,
      open: (login) => api.openExternal(login.verificationUri),
      refresh: (account) => api.refreshDeepSeekAccountQuota(account.id, locale),
      remove: (account) => api.deleteDeepSeekAccount(account.id),
      label: (account) => account.name,
      pollInterval: 1500,
    }
  );
}
