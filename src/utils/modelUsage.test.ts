import { describe, expect, it } from 'vitest';
import { compactCountdown, compactModelUsage, quotaPercent } from './modelUsage';

const now = Date.UTC(2027, 0, 1);
const fiveHour = { period: 'fiveHour' as const, percentage: 99, resetAt: now + 248 * 60_000 };
const weekly = { period: 'weekly' as const, percentage: 20, resetAt: now + 3 * 86400_000 };
const monthly = { period: 'monthly' as const, percentage: 80, resetAt: now + 12 * 86400_000 };

describe('model quota display', () => {
  it('shows remaining allowance and fixes parentheses to the weekly window regardless of order', () => {
    expect(compactModelUsage({ quotas: [monthly, weekly, fiveHour] }, now)).toBe('1% 4h8m(80%)');
    expect(quotaPercent(weekly)).toBe(80);
  });
  it('never substitutes a monthly percentage for an absent weekly quota', () => {
    expect(compactModelUsage({ quotas: [fiveHour, monthly] }, now)).toBe('1% 4h8m');
    expect(compactModelUsage({ quotas: [weekly] }, now)).toBe('7d 80% 3d0h');
  });
  it('keeps legacy percentages without exposing their placeholder reset times', () => {
    expect(
      compactModelUsage({ quotas: [{ percentage: 35, resetAt: now + 30 * 86400_000 }] }, now)
    ).toBe('35%');
  });
  it('keeps unknown resets hidden and does not invent missing quotas', () => {
    expect(compactModelUsage({ quotas: [{ ...fiveHour, resetAt: 0 }, weekly] }, now)).toBe(
      '1%(80%)'
    );
    expect(compactModelUsage({ quotas: [] }, now)).toBe('');
    expect(compactCountdown(0, now)).toBe('');
    expect(compactCountdown(now - 1, now)).toBe('0m');
    expect(compactCountdown(now + 1, now)).toBe('1m');
    expect(quotaPercent({ ...fiveHour, percentage: NaN })).toBeNull();
  });
});
