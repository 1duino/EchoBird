import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';
import { useUiScaleStore } from '../stores/uiScaleStore';

const mocks = vi.hoisted(() => ({ zoom: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '' }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ setZoom: mocks.zoom }) }));
vi.mock('@tauri-apps/api/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/window')>()),
  currentMonitor: async () => null,
  getCurrentWindow: () => ({}),
}));
vi.mock('@tauri-apps/plugin-autostart', () => ({ isEnabled: async () => false }));
vi.mock('../api/tauri', () => ({ getSettings: async () => ({}), saveSettings: mocks.save }));
vi.mock('../hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../stores/themeStore', () => ({
  useThemeStore: (select: (state: unknown) => unknown) =>
    select({ mode: 'dark', colorTheme: 'oatgray' }),
}));

let view: ReactTestRenderer;
const props = { isOpen: true, onClose: vi.fn(), locale: 'en', onLocaleChange: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.zoom.mockResolvedValue(undefined);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
  useUiScaleStore.setState({
    preference: 'auto',
    requestedPreference: null,
    scale: 1,
    pending: false,
    failed: false,
  });
});
afterEach(async () => {
  await act(async () => view?.unmount());
  vi.unstubAllGlobals();
});

async function tab(label: string) {
  await act(async () => {
    view.root
      .findAllByType('button')
      .find((button) => button.props.children.includes(label))!
      .props.onClick();
  });
}

it('only changes scale on explicit selection, not settings entry, tab changes or reopening', async () => {
  await act(async () => {
    view = create(<SettingsDialog {...props} />);
  });
  await tab('settings.appearance');
  await tab('settings.general');
  await tab('settings.appearance');
  await act(async () => {
    view.update(<SettingsDialog {...props} isOpen={false} />);
  });
  await act(async () => {
    view.update(<SettingsDialog {...props} />);
  });
  expect(mocks.zoom).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(localStorage.setItem).not.toHaveBeenCalled();

  const slider = view.root.findByProps({ id: 'ui-scale' });
  expect(slider.props).toMatchObject({ type: 'range', min: 70, max: 150, step: 1, value: 100 });
  await act(async () => {
    slider.props.onChange({ target: { value: '103' } });
  });
  expect(mocks.zoom).toHaveBeenCalledExactlyOnceWith(1.03);
  expect(localStorage.setItem).toHaveBeenCalledExactlyOnceWith('echobird-ui-scale', '103');
});

it('keeps the slider responsive while applying and shows failure without a blocking dialog', async () => {
  await act(async () => {
    view = create(<SettingsDialog {...props} />);
  });
  await tab('settings.appearance');
  await act(async () => {
    useUiScaleStore.setState({ pending: true, requestedPreference: 70 });
  });
  expect(view.root.findByProps({ id: 'ui-scale' }).props.disabled).toBeUndefined();
  expect(view.root.findByProps({ id: 'ui-scale' }).props.value).toBe(70);
  await act(async () => {
    useUiScaleStore.setState({ pending: false, failed: true, requestedPreference: null });
  });
  expect(view.root.findByProps({ role: 'alert' }).props.children).toBe('settings.uiScaleError');
  expect(view.root.findByProps({ id: 'ui-scale' }).props.disabled).toBeUndefined();
});

it('keeps the original drag coordinates as the window and UI resize and can return to automatic', async () => {
  await act(async () => {
    view = create(<SettingsDialog {...props} />);
  });
  await tab('settings.appearance');
  const target = {
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    getBoundingClientRect: () => ({ left: 100, width: 414 }),
  };
  await act(async () => {
    view.root.findByProps({ id: 'ui-scale' }).props.onPointerDown({
      button: 0,
      preventDefault: vi.fn(),
      currentTarget: target,
      pointerId: 1,
      clientX: 257,
      screenX: 1000,
    });
    // The new client coordinate deliberately disagrees after zoom/recentering.
    view.root.findByProps({ id: 'ui-scale' }).props.onPointerMove({ screenX: 1250, clientX: 10 });
    view.root.findByProps({ id: 'ui-scale' }).props.onPointerUp();
  });
  expect(target.setPointerCapture).toHaveBeenCalledWith(1);
  expect(useUiScaleStore.getState()).toMatchObject({ preference: 150, scale: 1.5 });
  expect(localStorage.setItem).toHaveBeenLastCalledWith('echobird-ui-scale', '150');
  await act(async () => {
    view.root.findByProps({ id: 'ui-scale' }).props.onPointerMove({ screenX: 0 });
  });
  expect(useUiScaleStore.getState().preference).toBe(150);
  await act(async () => {
    view.root
      .findAllByType('button')
      .find((button) => button.props.children === 'settings.uiScaleAuto')!
      .props.onClick();
  });
  expect(useUiScaleStore.getState().preference).toBe('auto');
  expect(localStorage.setItem).toHaveBeenLastCalledWith('echobird-ui-scale', 'auto');
});

async function startScaleDrag(percent = 100) {
  await act(async () => {
    view = create(<SettingsDialog {...props} />);
  });
  await tab('settings.appearance');
  await act(async () => {
    view.root.findByProps({ id: 'ui-scale' }).props.onPointerDown({
      button: 0,
      preventDefault: vi.fn(),
      pointerId: 1,
      clientX: 107 + (percent - 70) * 5,
      screenX: 1000,
      currentTarget: {
        focus: vi.fn(),
        setPointerCapture: vi.fn(),
        getBoundingClientRect: () => ({ left: 100, width: 414 }),
      },
    });
  });
}

it.each(['close', 'tab'])(
  'clears an interrupted scale drag on %s before keyboard input',
  async (exit) => {
    await startScaleDrag();
    if (exit === 'close') {
      await act(async () => {
        view.update(<SettingsDialog {...props} isOpen={false} />);
      });
      await act(async () => {
        view.update(<SettingsDialog {...props} />);
      });
    } else {
      await tab('settings.general');
      await tab('settings.appearance');
    }
    await act(async () => {
      view.root.findByProps({ id: 'ui-scale' }).props.onChange({ target: { value: '101' } });
    });
    expect(useUiScaleStore.getState().preference).toBe(101);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('echobird-ui-scale', '101');
  }
);

it('shows nine non-interactive ticks at every ten percent', async () => {
  await startScaleDrag();
  const ticks = view.root.findByProps({ 'data-scale-ticks': true });
  expect(ticks.props['aria-hidden']).toBe(true);
  expect(ticks.findAllByType('span').map((tick) => tick.props['data-scale-tick'])).toEqual([
    70, 80, 90, 100, 110, 120, 130, 140, 150,
  ]);
});

it.each([
  [72, 70],
  [78, 80],
  [98, 100],
  [102, 100],
  [108, 110],
  [148, 150],
])(
  'attracts a pointer press at %s percent to the nearby %s percent tick',
  async (pointer, expected) => {
    await startScaleDrag(pointer);
    expect(useUiScaleStore.getState().preference).toBe(expected);
  }
);

it.each([
  [97, 100],
  [103, 100],
  [106, 110],
  [114, 110],
])(
  'moves freely to %s outside the attraction zone, then settles at %s on release',
  async (pointer, expected) => {
    await startScaleDrag();
    await act(async () => {
      view.root
        .findByProps({ id: 'ui-scale' })
        .props.onPointerMove({ screenX: 1000 + (pointer - 100) * 5 });
    });
    expect(useUiScaleStore.getState().preference).toBe(pointer);
    await act(async () => {
      view.root.findByProps({ id: 'ui-scale' }).props.onPointerUp();
    });
    expect(useUiScaleStore.getState().preference).toBe(expected);
    expect(localStorage.setItem).toHaveBeenLastCalledWith('echobird-ui-scale', String(expected));
  }
);

it('releases the attraction when pulled beyond the zone and snaps from either side', async () => {
  await startScaleDrag();
  for (const [pointer, expected] of [
    [101, 100],
    [103, 103],
    [109, 110],
    [107, 107],
    [102, 100],
  ]) {
    await act(async () => {
      view.root
        .findByProps({ id: 'ui-scale' })
        .props.onPointerMove({ screenX: 1000 + (pointer - 100) * 5 });
    });
    expect(useUiScaleStore.getState().preference).toBe(expected);
  }
});
