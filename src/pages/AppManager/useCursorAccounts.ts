import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

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
  return useManagedAccounts<api.CursorAccount, api.CursorLogin>(
    tool,
    enabled,
    false,
    clearModel,
    showError,
    {
      ...client,
      open: (login) => api.openExternal(login.verificationUri),
      remove: (account) => client.remove(account.id),
      refresh: async (account) => ({ ...account, usage: await client.refresh(account.id) }),
      label: (account) => account.email,
    }
  );
}
