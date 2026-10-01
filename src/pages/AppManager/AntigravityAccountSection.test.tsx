import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { AntigravityAccountSection } from './AntigravityAccountSection';
import { AppManagerContext, type AppManagerContextType } from './context';

describe.each(['antigravity', 'antigravitydesktop'] as const)('%s account controls', (tool) => {
  const fixture = (refreshing = false) => {
    const select = vi.fn();
    const refresh = vi.fn();
    const remove = vi.fn();
    const account = {
      id: 'one',
      email: 'one@example.test',
      active: true,
      plan: 'Ultra',
      quotas: [
        { name: 'gemini-3', remainingPercent: 0, resetAt: null },
        { name: 'gemini-3-fast', remainingPercent: 40, resetAt: null },
        { name: 'claude-sonnet', remainingPercent: 75, resetAt: null },
      ],
    };
    const context = {
      selectedTool: tool,
      isLaunching: false,
      antigravityAccounts: {
        accounts: [account],
        selectedId: account.id,
        select,
        refresh,
        remove,
        refreshing: new Set(refreshing ? [account.id] : []),
        add: vi.fn(),
        busy: false,
        remainingSeconds: 0,
      },
    } as unknown as AppManagerContextType;
    return {
      select,
      refresh,
      remove,
      element: (
        <AppManagerContext.Provider value={context}>
          <AntigravityAccountSection />
        </AppManagerContext.Provider>
      ),
    };
  };

  it('shows the plan once and the lowest real quota in each model family', () => {
    const renderer = create(fixture(true).element);
    const markup = JSON.stringify(renderer.toJSON());
    expect(markup).toContain(`/icons/tools/${tool}.png`);
    expect(markup.match(/Ultra/g)).toHaveLength(1);
    expect(markup).toContain('Gemini 0%');
    expect(markup).toContain('Claude 75%');
    expect(
      renderer.root.findByProps({ role: 'radio' }).findAllByType('button')[0].props.disabled
    ).toBe(true);
    act(() => renderer.unmount());
  });

  it('keeps refresh and delete actions separate from account selection', () => {
    const { element, select, refresh, remove } = fixture();
    const renderer = create(element);
    const row = renderer.root.findByProps({ role: 'radio' });
    act(() =>
      row
        .findAllByType('button')
        .forEach((button) => button.props.onClick({ stopPropagation: vi.fn() }))
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
