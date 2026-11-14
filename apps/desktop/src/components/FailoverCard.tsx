import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X } from 'lucide-react';
import type { AgentId, AgentInfo, ModelChoice } from '@bspace-sdlc-app/shared';
import { AgentLogo } from '@/components/AgentLogo';
import { Button } from '@/components/Button';
import { AGENT_NAMES } from '@/lib/agents';
import { accountOf, KNOWN_MODELS, useFailover } from '@/state/failover';
import { EXACT_LIST, useModels } from '@/state/models';
import { useClaudeAccount } from '@/state/claudeAccount';
import { useConnections } from '@/state/connections';
import { accountKey, DEFAULT_ACCOUNT, MULTI_ACCOUNT, useAccounts } from '@/state/accounts';
import type { AccountView } from '@/lib/ipc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Every model to offer for an agent: its full list with every version (Anthropic's for Claude, `opencode
 * models`), what the agent reports in a session (its shortcuts, like `sonnet`), the known ones, then the
 * ones added by hand.
 */
export function useModelChoices(agent: AgentId): ModelChoice[] {
  const catalog = useModels((s) => s.catalog[agent]);
  const reported = useModels((s) => s.byAgent[agent]?.options);
  const extra = useFailover((s) => s.extra[agent]);
  // Models the agent's active account refused ("not supported with this account") are not offered.
  const refused = useFailover((s) => s.incompatible[accountOf(agent, useAccounts.getState().activeOf(agent))]);
  const seen = new Set<string>([...(refused ?? [])]);
  // Codex: only the account's own list, never the session's (which names API-only models).
  const own = catalog?.length && EXACT_LIST.includes(agent) ? [] : (reported ?? []);
  return [...(catalog ?? []), ...own, ...(catalog?.length ? [] : (KNOWN_MODELS[agent] ?? [])), ...(extra ?? []).map((value) => ({ value, name: value }))].filter(
    (m) => m.value !== 'default' && !seen.has(m.value) && !!seen.add(m.value),
  );
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Which family a model belongs to, for the menu's groups: `claude-opus-5-5` → Opus, `openai/gpt-5.5` →
 * openai, `gpt-5.5-codex` → GPT. Shortcuts the agent offers (`sonnet`, `opus[1m]`) group as Shortcuts.
 */
export function modelFamily(agent: AgentId, id: string): string | null {
  if (id.includes('/')) return id.split('/')[0]!;
  const claude = /^claude-(?:\d[\d.-]*-)?([a-z]+)/.exec(id);
  if (claude) return cap(claude[1]!);
  if (agent === 'claude') return null;
  const head = /^([a-z]+)/i.exec(id)?.[1];
  return head ? (head.length <= 3 ? head.toUpperCase() : cap(head)) : null;
}

/** The choices grouped by family, families in the order they first appear; shortcuts last. */
export function groupModels(agent: AgentId, choices: ModelChoice[]): { family: string | null; items: ModelChoice[] }[] {
  const groups = new Map<string | null, ModelChoice[]>();
  for (const m of choices) {
    const f = modelFamily(agent, m.value);
    groups.set(f, [...(groups.get(f) ?? []), m]);
  }
  const out = [...groups].map(([family, items]) => ({ family, items }));
  return [...out.filter((g) => g.family !== null), ...out.filter((g) => g.family === null)];
}

/**
 * An agent's accounts as small chips on one line: who is signed in (the active one marked), × to sign
 * out or remove, and "+ Account" to add another (Claude, Codex and opencode can have several).
 */
function AccountChips({ a, connectedText }: { a: AgentInfo; connectedText: string | null }) {
  const { t } = useTranslation();
  const list = useAccounts((s) => s.list);
  const signingIn = useAccounts((s) => s.signingIn);
  const failed = useAccounts((s) => s.failed);
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const chip = 'inline-flex h-6 max-w-full items-center gap-buma-xs rounded-[5px] border px-buma-xs text-[12px] leading-none';
  if (!a.installed) return <span className="text-[12px] text-text-3">{t('settings.failover.notInstalled')}</span>;
  // Your API is a key, not an account.
  if (a.id === 'custom') return <span className="truncate text-[12px] text-text-3">{connectedText ?? t('connection.notSignedIn')}</span>;
  const multi = MULTI_ACCOUNT.includes(a.id);
  // Agents with one account (Gemini, Antigravity) show it as one chip too.
  const accounts: AccountView[] = multi
    ? (list ?? []).filter((x) => x.agent === a.id)
    : [{ id: DEFAULT_ACCOUNT, agent: a.id, account: connectedText, signedIn: !!connectedText, active: true }];
  const key = (id: string) => accountKey(a.id, id);
  const adding = !!signingIn[key('new')];
  const error = failed[key('new')] || accounts.map((x) => failed[key(x.id)]).find(Boolean);
  const after = () => void useClaudeAccount.getState().refresh();
  const signOut = async (id: string) => {
    const store = useAccounts.getState();
    // An extra account is removed with its sign-in; a default one is signed out.
    if (id === DEFAULT_ACCOUNT) await store.signOut(a.id, id);
    else await store.remove(a.id, id);
    after();
  };
  return (
    <div data-testid={`accounts-${a.id}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-buma-xs">
        {accounts.map((x) => {
          const name = x.account ?? (x.signedIn ? t('settings.connected') : t('connection.notSignedIn'));
          const busy = !!signingIn[key(x.id)];
          // Every signed-in account can be signed out, except Antigravity's (Buma doesn't know where it keeps it).
          const removable = (x.signedIn || x.id !== DEFAULT_ACCOUNT) && a.id !== 'antigravity';
          // The default Codex, opencode or Gemini account is the CLI's own sign-in: ask first.
          const shared = x.id === DEFAULT_ACCOUNT && a.id !== 'claude';
          return (
            <span key={x.id} className={cn(chip, x.active && x.signedIn ? 'border-primary bg-primary-soft text-foreground' : 'border-border bg-raised text-text-2')}>
              <button
                type="button"
                title={x.active ? t('settings.route.activeAccount') : t('settings.route.useAccount', { account: name })}
                disabled={!multi || !x.signedIn || x.active}
                onClick={() => {
                  void useAccounts.getState().use(a.id, x.id).then(after);
                }}
                className="flex min-w-0 cursor-pointer items-center gap-buma-xs border-0 bg-transparent p-0 text-inherit disabled:cursor-default"
              >
                <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', x.signedIn ? 'bg-primary' : 'bg-border')} />
                <span className="truncate">{busy ? t('settings.route.signingIn') : name}</span>
              </button>
              {multi && !x.signedIn && !busy && (
                <button type="button" onClick={() => void useAccounts.getState().signIn(a.id, x.id)} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-medium text-primary-text hover:underline">
                  {t('settings.route.signIn')}
                </button>
              )}
              {removable && !busy && (
                <button
                  type="button"
                  aria-label={x.id === DEFAULT_ACCOUNT ? t('settings.route.signOutAccount', { account: name }) : t('settings.route.removeAccount', { account: name })}
                  title={x.id === DEFAULT_ACCOUNT ? t('claudeAccount.signOut') : t('settings.route.remove')}
                  onClick={() => (shared ? setConfirm({ id: x.id, name }) : void signOut(x.id))}
                  className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-text-3 hover:text-foreground"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              )}
            </span>
          );
        })}
        {adding && (
          <span className={cn(chip, 'border-dashed border-border text-text-2')}>
            <RefreshCw size={11} aria-hidden="true" className="animate-spin" />
            {t('settings.route.signingIn')}
          </span>
        )}
      </div>
      {error && <span className="text-[11px] break-words text-error">{error}</span>}
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t('settings.route.signOutTitle', { name: AGENT_NAMES[a.id] })}</DialogTitle>
            <DialogDescription>{t('settings.route.signOutShared', { name: AGENT_NAMES[a.id], account: confirm?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              // i18n-ignore: a BUMA button condition, not copy
              condition="reject"
              onClick={() => {
                const id = confirm?.id;
                setConfirm(null);
                if (id) void signOut(id);
              }}
            >
              {t('claudeAccount.signOut')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Agents › Provider: the AI platforms on this computer and who is signed in to each (several accounts
 * for Claude, Codex and opencode), with a "+" on every row to connect or add an account. Which models
 * chats use, and in what order, is set in Agents › Combo.
 */
export function AgentRoute({ agents, actions }: { agents: AgentInfo[]; actions(a: AgentInfo): ReactNode }) {
  const { t } = useTranslation();
  const marked = useConnections((s) => s.signedIn);

  useEffect(() => {
    void useAccounts.getState().load();
    // The account's own model list (Codex): read now, so models it can't run leave the combos at once.
    for (const agent of EXACT_LIST) void useModels.getState().loadCatalog(agent, true);
  }, []);
  // Combos skip agents that are not set up here.
  useEffect(() => {
    if (agents.length) useFailover.getState().setReady(agents.filter((a) => a.installed).map((a) => a.id));
  }, [agents]);

  // Set-up agents first, in the usual order.
  const rows = [...agents.filter((a) => a.installed), ...agents.filter((a) => !a.installed)];

  return (
    <section aria-labelledby="route-title" className="flex flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-buma-2xs px-buma-md py-buma-sm">
        <span id="route-title" className="text-sm font-medium">
          {t('settings.route.title')}
        </span>
        <span className="text-xs text-text-3">{t('settings.route.hint')}</span>
      </div>
      <ol className="m-0 flex list-none flex-col p-0">
        {rows.map((a) => {
          // Who is signed in (never the version), for agents with one account.
          const connectedText = a.account ?? (a.signedIn || marked.includes(a.id) ? t('settings.connected') : null);
          return (
            <li key={a.id} data-testid={`failover-${a.id}`} className="flex flex-col gap-buma-xs border-t border-border px-buma-md py-buma-sm">
              {/* One line, centered: logo, name, then the row's "+". */}
              <div className="flex min-h-6 items-center gap-buma-sm">
                <span className={cn('flex size-5 shrink-0 items-center justify-center', !a.installed && 'opacity-60')}>
                  <AgentLogo id={a.id} size={18} />
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-[13px] font-medium', !a.installed && 'opacity-60')}>{AGENT_NAMES[a.id]}</span>
                <span className="flex shrink-0 items-center gap-buma-2xs">{actions(a)}</span>
              </div>
              {/* Accounts line up under the name (logo 20 + gap 12). */}
              <div className="min-w-0 pl-8">
                <AccountChips a={a} connectedText={connectedText} />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
