import { useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../api/tauri';
import { useToolsStore } from '../../stores/toolsStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { AppManagerProvider } from './AppManagerProvider';
import { useAppManager } from './context';

vi.hoisted(() => vi.stubGlobal('__APP_EDITION__', 'full'));
vi.mock('../../utils/platform', () => ({ IS_WINDOWS: true }));
vi.mock('../../hooks/useI18n', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'en' }) };
});
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('../../components', () => ({ EFFORT_PULSE_ONESHOT_MS: 0 }));
vi.mock('../ModelNexus/context', () => {
  const userModels: never[] = [];
  return { useModelNexus: () => ({ userModels }) };
});
vi.mock('../FreeModels', () => ({ useFreeModels: () => ({ routerEnabled: false }) }));
vi.mock('./useClaudeCodeAccounts', () => ({ useClaudeCodeAccounts: () => ({}) }));
vi.mock('./useWorkBuddyAccounts', () => ({ useWorkBuddyAccounts: () => ({}) }));
vi.mock('./useDeepSeekAccounts', () => ({ useDeepSeekAccounts: () => ({}) }));
vi.mock('./useGrokAccounts', () => ({ useGrokAccounts: () => ({}) }));
vi.mock('../../api/tauri', () => ({
  getModels: vi.fn().mockResolvedValue([]),
  getInstallIndex: vi.fn().mockResolvedValue('{"ids":[]}'),
  listGrokBotAccounts: vi.fn().mockRejectedValue(new Error('accountError.read')),
  listCursorAccounts: vi.fn().mockRejectedValue(new Error('accountError.read')),
  startGrokBotLogin: vi.fn(),
  pollGrokBotLogin: vi.fn(),
  cancelGrokBotLogin: vi.fn(),
  deleteGrokBotAccount: vi.fn(),
  startCursorLogin: vi.fn(),
  pollCursorLogin: vi.fn(),
  cancelCursorLogin: vi.fn(),
  deleteCursorAccount: vi.fn(),
  refreshGrokBotAccount: vi.fn(),
  refreshCursorAccount: vi.fn(),
}));

describe.each(['grokbot', 'cursor'] as const)('%s navigation account loading', (tool) => {
  let renderer: ReactTestRenderer;
  let context: ReturnType<typeof useAppManager>;
  const list = tool === 'grokbot' ? api.listGrokBotAccounts : api.listCursorAccounts;
  const setInstalled = (installed: boolean) =>
    useToolsStore
      .getState()
      .setDetectedTools([{ id: tool, name: tool, category: 'Desktop', installed }]);
  function Harness() {
    const state = useAppManager();
    useLayoutEffect(() => {
      context = state;
    });
    return null;
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useNavigationStore.getState().setActivePage('apps');
    setInstalled(false);
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    useToolsStore.getState().setDetectedTools([]);
    vi.useRealTimers();
  });

  it('skips uninstalled clients and never turns navigation read failures into dialogs or quota refreshes', async () => {
    await act(async () => {
      renderer = create(
        <AppManagerProvider>
          <Harness />
        </AppManagerProvider>
      );
    });
    act(() => {
      context.setViewMode('install');
      context.setSelectedTool(tool);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(list).not.toHaveBeenCalled();
    expect(context.applyError).toBeNull();

    act(() => {
      setInstalled(true);
      context.setViewMode('desktop');
      context.setSelectedTool(tool);
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(context.applyError).toBeNull();

    act(() => context.setViewMode('install'));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(api.refreshGrokBotAccount).not.toHaveBeenCalled();
    expect(api.refreshCursorAccount).not.toHaveBeenCalled();
  });
});
