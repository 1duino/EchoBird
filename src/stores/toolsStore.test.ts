import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as api from '../api/tauri';
import type { LocalTool } from '../api/types';

vi.mock('../api/tauri', () => ({ scanTools: vi.fn() }));

class PendingImage {
  static instances: PendingImage[] = [];
  src = '';
  resolve!: () => void;
  reject!: () => void;
  decode = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        this.resolve = resolve;
        this.reject = () => reject(new Error('Broken image'));
      })
  );
  constructor() {
    PendingImage.instances.push(this);
  }
}

const tool = (id: string, installed = true): LocalTool => ({
  id,
  name: id,
  category: 'Desktop',
  installed,
});
let store: typeof import('./toolsStore').useToolsStore;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  PendingImage.instances = [];
  vi.stubGlobal('Image', PendingImage);
  store = (await import('./toolsStore')).useToolsStore;
});
afterEach(() => vi.unstubAllGlobals());

async function image(src: string) {
  await vi.waitFor(() => expect(PendingImage.instances.some((img) => img.src === src)).toBe(true));
  return PendingImage.instances.find((img) => img.src === src)!;
}

it('publishes both tabs together only after the last icon has decoded', async () => {
  vi.mocked(api.scanTools).mockResolvedValue([tool('one'), tool('two', false)]);
  const scan = store.getState().scanTools();
  (await image('./icons/tools/one.svg')).resolve();
  await Promise.resolve();
  expect(store.getState().detectedTools).toEqual([]);
  expect(store.getState().isScanning).toBe(true);

  (await image('./icons/tools/two.svg')).resolve();
  await scan;
  expect(store.getState().detectedTools.map((t) => t.icon)).toEqual([
    './icons/tools/one.svg',
    './icons/tools/two.svg',
  ]);
  expect(store.getState().isScanning).toBe(false);
});

it('resolves PNG, native and generic fallbacks before publishing, with dsh preferring PNG', async () => {
  const native = 'data:image/png;base64,native';
  vi.mocked(api.scanTools).mockResolvedValue([
    tool('png'),
    { ...tool('native'), iconBase64: native },
    { ...tool('broken'), iconBase64: 'data:image/png;base64,broken' },
    tool('dsh'),
  ]);
  const scan = store.getState().scanTools();
  for (const id of ['png', 'native', 'broken']) {
    (await image(`./icons/tools/${id}.svg`)).reject();
  }
  (await image('./icons/tools/png.png')).resolve();
  (await image('./icons/tools/native.png')).reject();
  (await image('./icons/tools/broken.png')).reject();
  (await image(native)).resolve();
  (await image('data:image/png;base64,broken')).reject();
  expect(store.getState().detectedTools).toEqual([]);
  (await image('./icons/tools/dsh.png')).resolve();
  await scan;
  expect(store.getState().detectedTools.map((t) => t.icon)).toEqual([
    './icons/tools/png.png',
    native,
    '',
    './icons/tools/dsh.png',
  ]);
  expect(PendingImage.instances.some((img) => img.src.endsWith('dsh.svg'))).toBe(false);
});

it('keeps the existing desktop during refresh and reuses decoded icons', async () => {
  vi.mocked(api.scanTools).mockResolvedValue([tool('one')]);
  const first = store.getState().scanTools();
  (await image('./icons/tools/one.svg')).resolve();
  await first;
  const previous = store.getState().detectedTools;

  vi.mocked(api.scanTools).mockResolvedValue([tool('one'), tool('new')]);
  const refresh = store.getState().scanTools();
  await image('./icons/tools/new.svg');
  expect(store.getState().detectedTools).toBe(previous);
  expect(PendingImage.instances.filter((img) => img.src.endsWith('one.svg'))).toHaveLength(1);
  (await image('./icons/tools/new.svg')).resolve();
  await refresh;
  expect(store.getState().detectedTools).toHaveLength(2);
});

it('does not start a second scan while icons are pending', async () => {
  vi.mocked(api.scanTools).mockResolvedValue([tool('one')]);
  const first = store.getState().scanTools();
  const pending = await image('./icons/tools/one.svg');
  const second = store.getState().scanTools();
  expect(api.scanTools).toHaveBeenCalledTimes(1);
  pending.resolve();
  await Promise.all([first, second]);
});

it('preserves the last desktop when detection fails', async () => {
  const previous = [tool('cached')];
  store.getState().setDetectedTools(previous);
  vi.mocked(api.scanTools).mockRejectedValue(new Error('Scan failed'));
  await store.getState().scanTools();
  expect(store.getState().detectedTools).toBe(previous);
  expect(store.getState().isScanning).toBe(false);
});
