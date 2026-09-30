import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import startupHtml from '../../index.html?raw';

const api = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock('../api/tauri', () => api);

let store: typeof import('./themeStore').useThemeStore;
let storage: Map<string, string>;
let root: { dataset: { theme?: string }; style: { setProperty: ReturnType<typeof vi.fn> } };
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  storage = new Map();
  root = { dataset: { theme: 'dark' }, style: { setProperty: vi.fn() } };
  media = { matches: false, addEventListener: vi.fn() };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', {
    documentElement: root,
    head: { appendChild: vi.fn() },
    body: { offsetHeight: 0 },
    createElement: () => ({ textContent: '', remove: vi.fn() }),
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => callback(0));
  api.getSettings.mockResolvedValue({ themeMode: 'dark' });
  api.saveSettings.mockResolvedValue(undefined);
  store = (await import('./themeStore')).useThemeStore;
});

afterEach(() => vi.unstubAllGlobals());

describe('default theme and saved preferences', () => {
  it('starts dark on a light OS before settings load and keeps the first palette', async () => {
    expect(store.getState()).toMatchObject({
      mode: 'dark',
      resolved: 'dark',
      colorTheme: 'oatgray',
    });
    await store.getState().init();
    expect(store.getState()).toMatchObject({
      mode: 'dark',
      resolved: 'dark',
      colorTheme: 'oatgray',
    });
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.setProperty).toHaveBeenCalledWith('--bg-base-rgb', '28 29 28');
    media.addEventListener.mock.calls[0][1]();
    expect(store.getState().resolved).toBe('dark');
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it.each(['light', 'dark'] as const)('restores saved %s mode and palette', async (mode) => {
    api.getSettings.mockResolvedValue({ themeMode: mode, colorTheme: 'aurora' });
    await store.getState().init();
    expect(store.getState()).toMatchObject({ mode, resolved: mode, colorTheme: 'aurora' });
    expect(root.dataset.theme).toBe(mode);
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it.each([undefined, null])(
    'preserves legacy system mode represented by %s',
    async (themeMode) => {
      api.getSettings.mockResolvedValue({ themeMode });
      await store.getState().init();
      expect(store.getState()).toMatchObject({ mode: 'system', resolved: 'light' });
      media.matches = true;
      media.addEventListener.mock.calls[0][1]();
      expect(root.dataset.theme).toBe('dark');
      expect(api.saveSettings).not.toHaveBeenCalled();
    }
  );

  it('persists an explicit system choice and restores it after restart', async () => {
    await store.getState().init();
    store.getState().setMode('system');
    await vi.waitFor(() => expect(api.saveSettings).toHaveBeenCalledOnce());
    const saved = api.saveSettings.mock.calls[0][0];
    expect(saved.themeMode).toBeUndefined();
    expect(root.dataset.theme).toBe('light');
    api.getSettings.mockResolvedValue(saved);
    vi.resetModules();
    store = (await import('./themeStore')).useThemeStore;
    await store.getState().init();
    expect(store.getState()).toMatchObject({ mode: 'system', resolved: 'light' });
  });
});

describe('startup theme before React mounts', () => {
  it.each([null, 'light', 'dark'])('uses cached %s or defaults to dark on a light OS', (cached) => {
    if (cached) storage.set('theme', cached);
    delete root.dataset.theme;
    const script = startupHtml.match(/<script>([\s\S]*?)<\/script>/)![1];
    new Function('localStorage', 'document', 'window', script)(localStorage, document, window);
    expect(root.dataset.theme).toBe(cached ?? 'dark');
  });
});
