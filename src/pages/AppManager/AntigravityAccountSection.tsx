import React from 'react';
import { useAppManager } from './context';
import { AccountSectionButton, AccountSectionRow } from './AccountSectionPrimitives';

export const AntigravityAccountSection: React.FC = () => {
  const { antigravityAccounts, isLaunching, selectedTool } = useAppManager();
  const { accounts, selectedId, select, busy, remainingSeconds, refreshing, refresh, add, remove } =
    antigravityAccounts;
  const minimum = (account: (typeof accounts)[number], prefix: string) => {
    const values = account.quotas.filter((quota) => quota.name.startsWith(prefix));
    return values.length ? Math.min(...values.map((quota) => quota.remainingPercent)) : null;
  };
  return (
    <section>
      <AccountSectionButton
        iconSrc={`/icons/tools/${selectedTool}.png`}
        busy={busy}
        disabled={isLaunching}
        remainingSeconds={remainingSeconds}
        onClick={() => void add()}
      />
      <div className="space-y-2">
        {accounts.map((account) => {
          const gemini = minimum(account, 'gemini');
          const claude = minimum(account, 'claude');
          const parts = [
            gemini == null ? null : `Gemini ${Math.round(gemini)}%`,
            claude == null ? null : `Claude ${Math.round(claude)}%`,
          ].filter(Boolean);
          return (
            <AccountSectionRow
              key={account.id}
              selected={selectedId === account.id}
              email={account.email}
              plan={account.plan}
              secondary={parts.length ? parts.join(' · ') : '—'}
              refreshing={refreshing.has(account.id)}
              onRefresh={() => void refresh(account)}
              onSelect={() => select(account.id)}
              onDelete={() => void remove(account)}
            />
          );
        })}
      </div>
    </section>
  );
};
