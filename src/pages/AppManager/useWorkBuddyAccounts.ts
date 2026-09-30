import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

export function useWorkBuddyAccounts(
  edition: api.WorkBuddyEdition | null,
  hasModel: boolean,
  clearModel: (edition: api.WorkBuddyEdition) => void,
  showError: (error: string) => void
) {
  const scope = edition ?? 'workbuddy';
  const managed = useManagedAccounts<api.WorkBuddyAccount, api.WorkBuddyLogin>(
    scope,
    edition !== null,
    hasModel,
    () => clearModel(scope),
    showError,
    {
      list: () => api.listWorkBuddyAccounts(scope),
      start: () => api.startWorkBuddyLogin(scope),
      poll: api.pollWorkBuddyLogin,
      cancel: api.cancelWorkBuddyLogin,
      open: (login) => api.openExternal(login.verificationUri),
      remove: (account) => api.deleteWorkBuddyAccount(account.edition, account.id),
      refresh: (account) => api.refreshWorkBuddyAccountQuota(account.edition, account.id),
      label: (account) => account.name,
      pollInterval: 1500,
    }
  );
  return { ...managed, accounts: edition ? managed.accounts : [] };
}
