import React, { useEffect, useState } from 'react';
import { Check, Gift } from 'lucide-react';
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
  const {
    accounts,
    selectedId,
    select,
    busy,
    remainingSeconds,
    refreshing,
    add,
    refresh,
    remove,
    claimDaily,
  } = workBuddyAccounts;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (selectedTool !== 'workbuddy') return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [selectedTool]);
  const claimedToday = (at?: number | null) =>
    at != null &&
    Math.floor((at + 8 * 3600) / 86400) === Math.floor((now / 1000 + 8 * 3600) / 86400);
  const formatCredits = (value?: number | null) =>
    value == null
      ? '—'
      : value.toLocaleString(undefined, { maximumFractionDigits: 2, useGrouping: false });
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
          {accounts.map((account) => {
            const hasBase = account.baseRemaining != null && (account.baseTotal ?? 0) > 0;
            const hasReward = account.rewardRemaining != null && (account.rewardTotal ?? 0) > 0;
            const hasAddon = account.addonRemaining != null && account.addonRemaining > 0;
            const dailyClaimed = claimedToday(account.dailyClaimedAt);
            return (
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
                leadingAction={
                  account.edition === 'workbuddy' ? (
                    <button
                      type="button"
                      aria-label={`${t(dailyClaimed ? 'agent.dailyCreditsClaimed' : 'agent.claimDailyCredits')} ${account.name}`}
                      disabled={refreshing.has(account.id) || dailyClaimed}
                      onClick={(event) => {
                        event.stopPropagation();
                        void claimDaily(account);
                      }}
                      className="account-icon-button flex h-5 w-5 items-center justify-center rounded-full disabled:opacity-40"
                    >
                      {dailyClaimed ? (
                        <Check size={12} aria-hidden="true" />
                      ) : (
                        <Gift size={12} aria-hidden="true" />
                      )}
                    </button>
                  ) : undefined
                }
                secondary={
                  <span className="flex h-[16px] min-w-0 items-center gap-1 overflow-hidden text-[11px] font-semibold whitespace-nowrap">
                    <span
                      className="flex flex-shrink-0 items-center gap-1"
                      aria-label={t('agent.baseCredits')}
                    >
                      {formatCredits(account.baseRemaining)}
                      {hasBase && (
                        <QuotaCountdown
                          resetAt={account.baseResetAt}
                          compact
                          label={t('agent.baseCreditsReset')}
                        />
                      )}
                    </span>
                    {hasAddon && (
                      <span className="flex-shrink-0" aria-label={t('agent.purchasedCredits')}>
                        {formatCredits(account.addonRemaining)}
                      </span>
                    )}
                    {account.edition === 'workbuddy' && !dailyClaimed ? (
                      <span className="flex-shrink-0" aria-label={t('agent.dailyCreditsUnclaimed')}>
                        {t('agent.dailyCreditsUnclaimed')}
                      </span>
                    ) : (
                      hasReward && (
                        <span
                          className="flex flex-shrink-0 items-center gap-0.5"
                          aria-label={t('agent.rewardCredits')}
                        >
                          <Gift size={10} aria-hidden="true" />
                          {formatCredits(account.rewardRemaining)}
                        </span>
                      )
                    )}
                  </span>
                }
              />
            );
          })}
        </div>
      )}
      {showDivider && <ModelSwitchDivider />}
    </section>
  );
};
