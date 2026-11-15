import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { AgentId, AgentInfo, Settings as SettingsT } from '@bspace-sdlc-app/shared';
import { AddConnectionDialog } from '@/features/agents/components/AddConnectionDialog';
import { AgentUsage } from '@/features/agents/components/AgentUsage';
import { ApiSetupDialog } from '@/features/agents/components/ApiSetupDialog';
import { Button } from '@/shared/ui/Button';
import { AgentRoute } from '@/features/agents/components/FailoverCard';
import { CombosTab } from '@/features/agents/components/CombosTab';
import { useFailover } from '@/features/agents/state/failover';
import { UsageTab } from '@/features/usage';
import { BumaLoading } from '@/shared/ui/buma/Loading';
import { Switch } from '@/shared/ui/primitives/switch';
import { BumaTabs } from '@/shared/ui/buma/Tabs';
import { detectAgents, updateSettings } from '@/shared/lib/ipc';
import { MULTI_ACCOUNT, useAccounts } from '@/features/agents/state/accounts';
import { AGENT_NAMES } from '@/shared/lib/agents';
import { useApp } from '@/shared/state/app';
import { useClaudeAccount } from '@/features/agents/state/claudeAccount';
import { isConnected, useConnections } from '@/features/agents/state/connections';

export type AgentsTab = 'usage' | 'provider' | 'combo';

/**
 * Agents, a screen of its own: Usage first (what the agents used, and each one's plan limits), then
 * Provider (the AI platforms on this computer and who is signed in) and Combo (the models chats run on).
 */
export function Agents() {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const asked = useApp((s) => (s.route.name === 'agents' ? s.route.tab : undefined));
  const [tab, setTab] = useState<AgentsTab>(asked ?? 'usage');
  useEffect(() => {
    if (asked) setTab(asked);
  }, [asked]);

  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [connecting, setConnecting] = useState<AgentId | null>(null);
  const [apiOpen, setApiOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claudeIn = useClaudeAccount((s) => !!s.account?.signedIn);
  const marked = useConnections((s) => s.signedIn);
  // Provider shows only once everything it reads is in (the agents, the Claude sign-in, the accounts),
  // so a signed-in agent never flashes Add connection first.
  const claudeLoaded = useClaudeAccount((s) => s.account !== null);
  const accountsLoaded = useAccounts((s) => s.list !== null);
  const ready = agentsLoaded && claudeLoaded && accountsLoaded;

  const reloadAgents = () => detectAgents().then(setAgents, () => {});
  // Who is signed in changed (a sign-in or sign-out): read the agents again.
  const changed = useAccounts((s) => s.changed);
  useEffect(() => {
    if (changed) void reloadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changed]);
  useEffect(() => {
    detectAgents()
      .then(setAgents)
      .catch(() => {})
      .finally(() => setAgentsLoaded(true));
    void useClaudeAccount.getState().refresh();
    void useAccounts.getState().load();
  }, []);

  const firstAgent = useFailover((s) => s.comboOf(s.defaultCombo)?.steps[0]?.agent ?? null);
  useEffect(() => {
    if (settings && firstAgent && firstAgent !== settings.defaultAgent) void save({ defaultAgent: firstAgent });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstAgent]);

  const save = async (patch: Partial<SettingsT>) => {
    setError(null);
    try {
      setSettings(await updateSettings(patch));
    } catch (e) {
      setError(t('settings.saveError', { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const pick = (next: AgentsTab) => {
    setTab(next);
    useApp.getState().navigate({ name: 'agents', tab: next });
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4 sm:p-8">
      <div data-tauri-drag-region className="flex flex-col gap-1">
        <h1 className="m-0 text-[28px] font-semibold tracking-[-0.01em]">{t('agentsScreen.title')}</h1>
        <span className="text-sm text-text-2">{t('agentsScreen.subtitle')}</span>
      </div>

      <BumaTabs
        value={tab}
        onValueChange={(v) => pick(v as AgentsTab)}
        aria-label={t('agentsScreen.tabsAria')}
        items={[
          { value: 'usage', label: t('settings.sections.usage') },
          { value: 'provider', label: t('settings.sections.agents') },
          { value: 'combo', label: t('combos.tab') },
        ]}
      />

      {error && (
        <p role="alert" className="m-0 text-[13px] text-error">
          {error}
        </p>
      )}

      {tab === 'provider' && settings && (
        <section aria-label={t('settings.sections.agents')} className="flex max-w-[860px] flex-col gap-3">
          <span className="text-[13px] text-text-2">{t('settings.agentsIntro')}</span>
          {!ready ? (
            <BumaLoading variant="data" labelText={t('settings.route.loading')} className="self-start py-6" />
          ) : (
            <AgentRoute
              agents={agents}
              actions={(a) => {
                // One "+" on every row, always there: it adds a connection. An agent that can have several
                // accounts and is connected gets another account; the rest open their setup.
                const on = isConnected(a, claudeIn, marked);
                const add = () => {
                  if (on && MULTI_ACCOUNT.includes(a.id)) void useAccounts.getState().add(a.id);
                  else if (a.id === 'custom') setApiOpen(true);
                  else setConnecting(a.id);
                };
                return (
                  <Button
                    variant="secondary"
                    iconOnly
                    small
                    data-testid={`connection-${a.id}`}
                    aria-label={t('connection.addTo', { name: AGENT_NAMES[a.id] })}
                    title={t('connection.addTo', { name: AGENT_NAMES[a.id] })}
                    onClick={add}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </Button>
                );
              }}
            />
          )}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="mr-auto flex flex-col gap-1">
              <label htmlFor="auto-mode" className="text-sm font-medium">
                {t('settings.autoMode')}
              </label>
              <span className="text-xs text-text-3">{t('settings.autoModeHint')}</span>
            </div>
            <Switch id="auto-mode" checked={settings.autoMode} aria-label={t('settings.autoMode')} onCheckedChange={(v) => void save({ autoMode: v })} />
          </div>
          <AddConnectionDialog
            agent={connecting}
            info={agents.find((a) => a.id === connecting)}
            connected={!!connecting && isConnected(agents.find((a) => a.id === connecting) ?? ({ installed: false } as AgentInfo), claudeIn, marked)}
            onOpenChange={(o) => !o && setConnecting(null)}
            onCheck={reloadAgents}
          />
          <ApiSetupDialog
            open={apiOpen}
            onOpenChange={setApiOpen}
            onSaved={(next) => {
              setSettings(next);
              void reloadAgents();
            }}
          />
        </section>
      )}

      {tab === 'combo' && (
        <section aria-label={t('combos.tab')} className="flex max-w-[860px] flex-col gap-buma-sm">
          {!ready ? <BumaLoading variant="data" labelText={t('settings.route.loading')} className="self-start py-6" /> : <CombosTab agents={agents} />}
        </section>
      )}

      {tab === 'usage' && (
        <section aria-label={t('settings.sections.usage')} className="flex max-w-[960px] flex-col gap-3">
          <AgentUsage onEditRoute={() => pick('combo')} />
          <h2 className="m-0 mt-2 text-sm font-medium">{t('agentUsage.limits')}</h2>
          <UsageTab />
        </section>
      )}
    </div>
  );
}
