import React from 'react';
import { useAppManager } from './context';
import { AccountSectionButton, AccountSectionRow } from './AccountSectionPrimitives';
import { useI18n } from '../../hooks/useI18n';

export const ManusAccountSection: React.FC = () => {
  const { manusAccounts, isLaunching } = useAppManager();
  const { t } = useI18n();
  return (
    <section>
      <AccountSectionButton
        iconSrc="/icons/tools/manus.png"
        busy={manusAccounts.busy}
        disabled={isLaunching}
        remainingSeconds={manusAccounts.remainingSeconds}
        onClick={() => void manusAccounts.add()}
      />
      {manusAccounts.accounts.length > 0 && (
        <div className="space-y-2">
          {manusAccounts.accounts.map((account) => {
            const credits = 'credits' in account ? account.credits : null;
            return (
              <AccountSectionRow
                key={account.id}
                selected={manusAccounts.selectedId === account.id}
                email={account.email}
                plan={account.plan}
                secondary={credits ? `${credits.total} ${t('agent.credits')}` : undefined}
                refreshing={manusAccounts.refreshing.has(account.id)}
                onSelect={() => manusAccounts.select(account.id)}
                onRefresh={() => void manusAccounts.refresh(account)}
                onDelete={() => void manusAccounts.remove(account)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};
