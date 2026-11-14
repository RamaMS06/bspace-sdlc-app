import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Spinner } from '@/shared/ui/Loading';
import { AgentBlock } from '@/features/usage/components/UsagePopover';
import { BumaLoading } from '@/shared/ui/buma/Loading';
import { useUsage } from '@/features/usage/state/usage';

/**
 * Settings › Usage: each agent's own usage (Claude Code's limits, what opencode spent).
 */
export function UsageTab() {
  const { t } = useTranslation();
  const agents = useUsage((s) => s.usage);
  const refreshAgents = useUsage((s) => s.refresh);
  const loadingAgents = useUsage((s) => s.loading);

  useEffect(() => {
    useUsage.getState().start();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t('usageTab.agents')}</span>
          <button
            type="button"
            aria-label={t('usage.refresh')}
            title={t('usage.refresh')}
            onClick={() => void refreshAgents(true)}
            disabled={loadingAgents}
            className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-3 hover:bg-raised hover:text-foreground disabled:cursor-default"
          >
            {loadingAgents ? <Spinner size={14} /> : <RefreshCw size={14} aria-hidden="true" />}
          </button>
        </div>
        {agents.length === 0 && loadingAgents ? (
          <BumaLoading variant="data" labelText={t('usage.loading')} className="self-start" />
        ) : agents.length === 0 ? (
          <span className="text-xs text-text-3">{t('usage.noAgents')}</span>
        ) : (
          agents.map((u) => <AgentBlock key={`${u.agentId}/${u.accountId ?? ''}`} u={u} />)
        )}
      </div>
    </div>
  );
}
