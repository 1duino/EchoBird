import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

export function useAntigravityAccounts(
  enabled: boolean,
  tool: 'antigravity' | 'antigravitydesktop',
  showError: (error: string) => void
) {
  return useManagedAccounts<api.AntigravityAccount, api.AntigravityLogin>(
    'antigravity',
    enabled,
    false,
    () => {},
    showError,
    {
      list: api.listAntigravityAccounts,
      start: api.startAntigravityLogin,
      poll: api.pollAntigravityLogin,
      cancel: api.cancelAntigravityLogin,
      open: (login) => api.openExternal(login.verificationUri),
      remove: (account) => api.deleteAntigravityAccount(account.id),
      refresh: (account) => api.refreshAntigravityAccount(account.id),
      label: (account) => account.email,
    },
    tool
  );
}
