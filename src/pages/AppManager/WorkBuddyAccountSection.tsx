import React from 'react';
import { useAppManager } from './context';
import { ModelSwitchDivider } from './ModelSwitchDivider';
import { AccountSectionButton, AccountSectionRow } from './AccountSectionPrimitives';
import { QuotaCountdown } from './QuotaCountdown';
import { useI18n } from '../../hooks/useI18n';
export const WorkBuddyAccountSection: React.FC<{ showDivider?: boolean }> = ({
  showDivider = true,
}) => {
  const { workBuddyAccounts, selectedTool } = useAppManager();
  const { t } = useI18n();
  const { accounts, selectedId, select, busy, remainingSeconds, refreshing, add, refresh, remove } =
    workBuddyAccounts;
  return (
    <section className={showDivider ? 'mb-3' : undefined}>
      <AccountSectionButton
        iconSrc={`/icons/tools/${selectedTool}.png`}
        colorClassName="workbuddy-account-pill"
        busy={busy}
        remainingSeconds={remainingSeconds}
        onClick={() => void add()}
      />
      {accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((account) => (
            <AccountSectionRow
              key={account.id}
              colorClassName="workbuddy-account-pill"
              selected={selectedId === account.id}
              email={account.name}
              plan={account.plan}
              refreshing={refreshing.has(account.id)}
              onSelect={() => select(account.id)}
              onRefresh={() => void refresh(account)}
              onDelete={() => void remove(account)}
              secondary={
                <span className="flex h-[16px] items-center justify-between">
                  <span className="h-1.5 min-w-0 max-w-[80px] flex-1 overflow-hidden rounded-full bg-cyber-border">
                    <span
                      className="block h-full rounded-full bg-cyber-bg"
                      style={{
                        width: `${account.total && account.remaining != null ? Math.min(100, Math.max(0, (account.remaining / account.total) * 100)) : 0}%`,
                      }}
                    />
                  </span>
                  <span className="min-w-[30px] flex-shrink-0 text-right text-[12px] font-semibold leading-[16px] text-cyber-text">
                    {account.remaining == null
                      ? '—'
                      : `${account.remaining.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${t('agent.credits')}`}
                  </span>
                  <QuotaCountdown resetAt={account.expiresAt} />
                </span>
              }
            />
          ))}
        </div>
      )}
      {showDivider && <ModelSwitchDivider />}
    </section>
  );
};
