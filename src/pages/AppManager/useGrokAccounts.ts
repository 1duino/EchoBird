import * as api from '../../api/tauri';
import { useManagedAccounts } from './useManagedAccounts';

const clients = {
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
  showError: (error: string) => void,
  tool: 'grok' | 'manus' = 'grok'
) {
  const client = clients[tool];
  const managed = useManagedAccounts<
    api.GrokAccount | api.ManusAccount,
    api.GrokLogin | api.ManusLogin
  >(tool, enabled, hasModel, clearModel, showError, {
    ...client,
    captured: (login) => ('account' in login ? login.account : null),
    open: (login) =>
      'verificationUri' in login ? api.openExternal(login.verificationUri) : Promise.resolve(),
    remove: (account) => client.remove(account.id),
    refresh: (account) => client.refresh(account.id),
    label: (account) => account.email,
  });
  const switchAccount = async () => {
    if (!managed.selectedId) return;
    await client.switch(managed.selectedId);
    await managed.reload();
  };
  return { ...managed, switchAccount };
}
