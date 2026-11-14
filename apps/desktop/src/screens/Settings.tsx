import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ChevronDown, ChevronRight, RefreshCw, SlidersHorizontal, UserRound, Wrench, type LucideIcon } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { disable as disableAutostart, enable as enableAutostart } from '@tauri-apps/plugin-autostart';
import { DEFAULT_SETTINGS, type AgentInfo, type Settings as SettingsT, type SystemInfo, type ToolId } from '@bspace-sdlc-app/shared';
import { ArchiveSection } from '@/components/ArchiveSection';
import { ClaudeAccountControl } from '@/components/ClaudeAccountControl';
import { AgentLogo } from '@/components/AgentLogo';
import { ApiSetupDialog } from '@/components/ApiSetupDialog';
import { Button } from '@/components/Button';
import { ToolRow, TOOL_ORDER } from '@/components/ToolRow';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AGENT_INSTALL_URL, AGENT_NAMES } from '@/lib/agents';
import { apiClear, apiUrlOverride, detectAgents, getSettings, getSystemInfo, pickFolder, updateSettings } from '@/lib/ipc';

/** What Rust says when background mode can't make its tray (and turned it back off). */
const TRAY_UNAVAILABLE = 'tray-unavailable';
import { LANGUAGES, LANGUAGE_NAMES, uiLanguage } from '@/i18n';
import { chooseLanguage } from '@/lib/language';
import { sendTestNotification } from '@/lib/scheduler';
import { useApp } from '@/state/app';
import { cn } from '@/lib/utils';
import { useInstall } from '@/state/install';
import { setTheme, useTheme, type ThemeChoice } from '@/lib/theme';
import { bumaButtonClass } from '@/components/buma/Button';
import { useDevops } from '@/state/devops';
import { useClaudeAccount } from '@/state/claudeAccount';
import { BumaBadge } from '@/components/buma/Badge';
import { useUpdater } from '@/state/updater';

const SECTIONS = ['general', 'tools', 'account', 'archive'] as const;
/** The section list as a tree: Agents has Usage under it. */
const TREE: ({ id: (typeof SECTIONS)[number]; icon: LucideIcon } | { group: 'agents'; icon: LucideIcon; children: { id: (typeof SECTIONS)[number]; icon: LucideIcon }[] })[] = [
  { id: 'general', icon: SlidersHorizontal },
  { id: 'tools', icon: Wrench },
  { id: 'account', icon: UserRound },
  { id: 'archive', icon: Archive },
];
export type SettingsTab = (typeof SECTIONS)[number];

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card">{children}</div>;
}

/** The app's version and a manual update check; what to do with a found update is in the sidebar. */
function UpdatesRow({ dev = import.meta.env.DEV }: { dev?: boolean }) {
  const { t } = useTranslation();
  const { phase, version, error, check } = useUpdater();
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    getVersion()
      .then((v) => !gone && setCurrent(v))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, []);
  const status = dev
    ? t('updates.devBuild')
    : phase === 'checking'
      ? t('updates.checking')
      : phase === 'none'
        ? t('updates.upToDate')
        : phase === 'available' || phase === 'downloading' || phase === 'ready'
          ? t('updates.available', { version: version ?? '' })
          : phase === 'error' && error
            ? t('updates.failed', { message: error })
            : undefined;
  return (
    <Row label={t('updates.label')} hint={current ? t('updates.version', { version: current }) : undefined} note={status}>
      <Button variant="secondary" disabled={dev || phase === 'checking'} onClick={() => void check()}>
        {t('updates.check')}
      </Button>
    </Row>
  );
}

/** Settings › Account: the Azure DevOps account the app is signed in with. Signing out goes back to the
 * sign-in step, since the app doesn't open without one. */
function DevopsAccount() {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const status = useDevops((s) => s.status);
  useEffect(() => {
    void useDevops.getState().init().catch(() => {});
  }, []);
  const p = status?.profile;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="mr-auto flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">{t('settings.devops.title')}</span>
        <span className="truncate text-xs text-text-3">
          {p ? t('settings.devops.signedInAs', { name: p.displayName, org: p.org }) : t('settings.devops.signedOut')}
        </span>
      </div>
      <Button
        variant="secondary"
        onClick={() =>
          void useDevops
            .getState()
            .signOut()
            .then(() => navigate({ name: 'onboarding-account' }))
            .catch(() => {})
        }
      >
        {t('onboarding.account.signOut')}
      </Button>
    </div>
  );
}

function ThemeRow() {
  const { t } = useTranslation();
  const { choice } = useTheme();
  return (
    <Row label={t('settings.appearance')} hint={t('settings.appearanceHint')}>
      <Segmented<ThemeChoice>
        label={t('settings.appearance')}
        value={choice}
        options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: t(`settings.themes.${v}`) }))}
        onChange={setTheme}
      />
    </Row>
  );
}

function Row({ label, hint, note, children }: { label: string; hint?: string; note?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-buma-sm border-b border-border px-buma-md py-buma-sm last:border-b-0">
      <div className="mr-auto flex min-w-0 flex-col gap-buma-2xs">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-text-3">{hint}</span>}
        {note && <span className="text-xs text-text-3">{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange(v: T): void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)}>
      <TabsList aria-label={label} className="h-9 bg-background">
        {options.map((o) => (
          <TabsTrigger key={o.value} value={o.value} disabled={o.disabled} className="px-3 text-[13px]">
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}


const TAB_KEY = 'buma.settingsTab';
const isTab = (v: unknown): v is SettingsTab => typeof v === 'string' && (SECTIONS as readonly string[]).includes(v);

/** The tab Settings opens on: the one asked for, else the one last used, else General. */
function startTab(asked: string | undefined): SettingsTab {
  if (isTab(asked)) return asked;
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (isTab(saved)) return saved;
  } catch {
    /* storage off: General */
  }
  return 'general';
}

export function Settings() {
  const { t } = useTranslation();
  // BUMA_API_URL (a dev setup) wins over the address saved here: say so instead of showing a value that isn't used.
  const [apiOverride, setApiOverride] = useState<string | null>(null);
  useEffect(() => {
    Promise.resolve()
      .then(() => apiUrlOverride())
      .then((v) => setApiOverride(v ?? null))
      .catch(() => setApiOverride(null));
  }, []);
  const settings = useApp((s) => s.settings);
  const askedTab = useApp((s) => (s.route.name === 'settings' ? s.route.tab : undefined));
  const [tab, setTab] = useState<SettingsTab>(() => startTab(askedTab));
  useEffect(() => {
    if (isTab(askedTab)) setTab(askedTab);
  }, [askedTab]);
  // Tree branches the user folded away (Agents › Usage shows by default).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const pickTab = (id: SettingsTab) => {
    setTab(id);
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {
      /* the choice just won't be remembered */
    }
  };
  const setSettings = useApp((s) => s.setSettings);
  const navigate = useApp((s) => s.navigate);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const claude = useClaudeAccount((s) => s.account);
  const [apiOpen, setApiOpen] = useState(false);
  const reloadAgents = () => void detectAgents().then(setAgents, () => {});
  const removeApi = async () => {
    setError(null);
    try {
      setSettings(await apiClear());
      reloadAgents();
    } catch (e) {
      setError(t('settings.saveError', { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const [sys, setSys] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statuses = useInstall((s) => s.statuses);
  const active = useInstall((s) => s.active);
  const closing = useInstall((s) => s.closing);
  const refresh = useInstall((s) => s.refresh);
  const start = useInstall((s) => s.start);
  const agentId = settings?.defaultAgent ?? 'claude';
  const agentName = AGENT_NAMES[agentId];

  const check = useCallback(() => {
    refresh(agentId).catch(() => {});
  }, [refresh, agentId]);

  useEffect(() => {
    useInstall.getState().listen();
    detectAgents()
      .then(setAgents)
      .catch(() => {});
    getSystemInfo()
      .then(setSys)
      .catch(() => {});
  }, []);
  useEffect(check, [check]);

  const [apiError, setApiError] = useState<string | null>(null);
  const save = async (patch: Partial<SettingsT>) => {
    setError(null);
    try {
      setSettings(await updateSettings(patch));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === TRAY_UNAVAILABLE) {
        // Rust turned background mode back off: show the saved settings and say why.
        setError(t('settings.trayUnavailable'));
        void getSettings().then(setSettings, () => {});
        return;
      }
      setError(t('settings.saveError', { message }));
    }
  };

  // Background mode keeps the app alive in the tray; "Open at login" only makes sense with it, so turning
  // the background off also turns the login item off. A failed OS change leaves the setting as it was.
  const changeBackground = async (on: boolean) => {
    if (!on && settings?.openAtLogin) {
      try {
        await disableAutostart();
      } catch (e) {
        setError(t('settings.backgroundError', { message: e instanceof Error ? e.message : String(e) }));
        return;
      }
      await save({ backgroundMode: false, openAtLogin: false });
      return;
    }
    await save({ backgroundMode: on });
  };
  const changeOpenAtLogin = async (on: boolean) => {
    try {
      await (on ? enableAutostart() : disableAutostart());
    } catch (e) {
      setError(t('settings.backgroundError', { message: e instanceof Error ? e.message : String(e) }));
      return;
    }
    await save({ openAtLogin: on });
  };

  const [testLine, setTestLine] = useState<string | null>(null);
  const testNotification = async () => {
    setTestLine(null);
    try {
      setTestLine((await sendTestNotification()) ? t('settings.testSent') : t('reminders.blocked'));
    } catch (e) {
      setTestLine(t('settings.testFailed', { message: e instanceof Error ? e.message : String(e) }));
    }
  };

  const changeFolder = async () => {
    try {
      const path = await pickFolder();
      if (path) await save({ workingFolder: path });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!settings) return null;

  const install = (tool: ToolId) => {
    if (sys) void start(tool, { sys, agent: agentId });
  };
  const tools = [...statuses].sort((a, b) => TOOL_ORDER.indexOf(a.id) - TOOL_ORDER.indexOf(b.id));

  return (
    <div className="flex h-full flex-wrap content-start gap-buma-lg overflow-y-auto p-buma-md sm:gap-buma-xl sm:p-buma-xl">
      <h1 data-tauri-drag-region className="m-0 flex-[1_1_100%] text-[28px] font-semibold tracking-[-0.01em]">
        {t('settings.title')}
      </h1>

      <div role="tablist" aria-orientation="vertical" aria-label={t('settings.sectionsAria')} className="flex min-w-0 flex-[1_1_200px] flex-col gap-buma-xs self-start md:max-w-[200px]">
        {TREE.map((node) => {
          const item = (id: SettingsTab, Icon: LucideIcon, child = false) => (
            <button
              key={id}
              id={`settings-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={id}
              onClick={() => pickTab(id)}
              className={cn(
                'relative flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-buma-xs rounded-md border-0 bg-transparent px-buma-sm py-buma-xs text-left text-sm font-medium hover:bg-raised hover:text-foreground',
                tab === id ? 'bg-raised text-foreground' : 'text-text-2',
                child && 'min-h-8 text-[13px]',
              )}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden="true" className={cn('shrink-0', tab === id && 'text-primary')} />
              <span className="truncate">{t(`settings.sections.${id}`)}</span>
            </button>
          );
          if (!('group' in node)) return item(node.id, node.icon);
          const open = !collapsed.has(node.group);
          const Icon = node.icon;
          const inside = node.children.some((c) => c.id === tab);
          return (
            <div key={node.group} className="flex flex-col gap-buma-xs">
              {/* A parent only folds its children open or shut; the children are the pages. */}
              <button
                type="button"
                aria-expanded={open}
                data-testid={`settings-group-${node.group}`}
                onClick={() =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (open) next.add(node.group);
                    else next.delete(node.group);
                    return next;
                  })
                }
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-buma-xs rounded-md border-0 bg-transparent px-buma-sm py-buma-xs text-left text-sm font-medium hover:bg-raised hover:text-foreground',
                  inside && !open ? 'bg-raised text-foreground' : 'text-text-2',
                )}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden="true" className={cn('shrink-0', inside && 'text-primary')} />
                <span className="flex-1 truncate">{t(`settings.groups.${node.group}`)}</span>
                {open ? <ChevronDown size={14} aria-hidden="true" className="text-text-3" /> : <ChevronRight size={14} aria-hidden="true" className="text-text-3" />}
              </button>
              {open && (
                // The tree's branch: a line down from the parent, an elbow into each child.
                <div role="group" aria-label={t(`settings.groups.${node.group}`)} className="ml-[17px] flex flex-col gap-buma-xs border-l border-border pl-buma-sm">
                  {node.children.map((c) => (
                    <div key={c.id} className="relative flex">
                      <span aria-hidden="true" className="absolute top-1/2 -left-3 w-2.5 border-t border-border" />
                      {item(c.id, c.icon, true)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex max-w-[720px] min-w-0 flex-[999_1_280px] flex-col gap-buma-xl">
        {error && (
          <p role="alert" className="m-0 text-[13px] text-error">
            {error}
          </p>
        )}

        {tab === 'general' && (
          <section id="general" role="tabpanel" aria-labelledby="settings-tab-general" className="flex flex-col gap-buma-sm">
            <h2 className="m-0 text-base font-medium">{t('settings.sections.general')}</h2>
            <Card>
              <Row label={t('settings.language')} hint={t('settings.languageHint')}>
                <Segmented
                  label={t('settings.language')}
                  value={uiLanguage()}
                  options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))}
                  onChange={(l) => void chooseLanguage(l)}
                />
              </Row>
              <ThemeRow />
              <Row
                label={t('settings.workingFolder')}
                hint={t('settings.workingFolderHint')}
                note={t('settings.workingFolderNote')}
              >
                <span className="max-w-[220px] truncate font-mono text-xs text-foreground" title={settings.workingFolder}>
                  {settings.workingFolder}
                </span>
                <Button variant="secondary" className="h-7 rounded-sm px-2 text-xs" onClick={() => void changeFolder()}>
                  {t('settings.change')}
                </Button>
              </Row>
              <UpdatesRow />
            </Card>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="mr-auto flex flex-col gap-1">
                <label htmlFor="background-mode" className="text-sm font-medium">
                  {t('settings.background')}
                </label>
                <span className="text-xs text-text-3">{t('settings.backgroundHint')}</span>
              </div>
              <Switch
                id="background-mode"
                checked={settings.backgroundMode}
                aria-label={t('settings.background')}
                onCheckedChange={(v) => void changeBackground(v)}
              />
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="mr-auto flex flex-col gap-1">
                <label htmlFor="open-at-login" className="text-sm font-medium">
                  {t('settings.openAtLogin')}
                </label>
                <span className="text-xs text-text-3">{t('settings.openAtLoginHint')}</span>
              </div>
              <Switch
                id="open-at-login"
                checked={settings.backgroundMode && settings.openAtLogin}
                disabled={!settings.backgroundMode}
                aria-label={t('settings.openAtLogin')}
                onCheckedChange={(v) => void changeOpenAtLogin(v)}
              />
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="mr-auto flex flex-col gap-1">
                <span className="text-sm font-medium">{t('settings.testNotification')}</span>
                {testLine && (
                  <span role="status" className="text-xs text-text-3">
                    {testLine}
                  </span>
                )}
              </div>
              <Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={() => void testNotification()}>
                {t('settings.testNotification')}
              </Button>
            </div>
          </section>
        )}

        {tab === 'tools' && (
          <section id="tools" role="tabpanel" aria-labelledby="settings-tab-tools" className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="mr-auto flex flex-col gap-1">
                <h2 className="m-0 text-base font-medium">{t('settings.sections.tools')}</h2>
                <span className="text-[13px] text-text-2">{t('settings.toolsIntro', { agent: agentName })}</span>
              </div>
              <Button
                variant="secondary"
                className="h-7 gap-1 rounded-sm bg-transparent px-2 text-xs text-foreground"
                disabled={!!active || closing}
                onClick={check}
              >
                <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
                {t('settings.checkAgain')}
              </Button>
            </div>
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border bg-card p-0">
              {tools.map((t) => (
                <ToolRow
                  key={t.id}
                  tool={t}
                  sys={sys}
                  agentName={agentName}
                  busy={!!active || closing || !sys}
                  onInstall={() => install(t.id)}
                />
              ))}
            </ul>
          </section>
        )}

        {/* One dialog for Agents and Account alike. */}
        <ApiSetupDialog
          open={apiOpen}
          onOpenChange={setApiOpen}
          onSaved={(next) => {
            setSettings(next);
            reloadAgents();
          }}
        />
        {tab === 'archive' && (
          <section id="archive" role="tabpanel" aria-labelledby="settings-tab-archive" className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-medium">{t('settings.sections.archive')}</h2>
            <ArchiveSection />
          </section>
        )}

        {tab === 'account' && (
          <section id="account" role="tabpanel" aria-labelledby="settings-tab-account" className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-medium">{t('settings.sections.account')}</h2>
            <DevopsAccount />
            <div className="mt-3 flex flex-col gap-1">
              <h3 className="m-0 text-sm font-medium">{t('settings.aiAccounts.title')}</h3>
              <span className="text-[13px] text-text-2">{t('settings.aiAccounts.intro')}</span>
            </div>
            <Card>
              {agents.filter((a) => a.installed).length === 0 && (
                <div className="px-4 py-3 text-[13px] text-text-3">{t('settings.aiAccounts.none')}</div>
              )}
              {agents
                .filter((a) => a.installed)
                .map((a) => (
                  <div key={a.id} data-testid={`ai-account-${a.id}`} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                    <AgentLogo id={a.id} size={20} />
                    <div className="mr-auto flex min-w-0 flex-col gap-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {AGENT_NAMES[a.id]}
                        {settings.defaultAgent === a.id && <BumaBadge variant="success" label={t('settings.aiAccounts.default')} />}
                      </span>
                      <span className="truncate text-xs text-text-3">
                        {a.id === 'claude'
                          ? claude?.signedIn
                            ? [claude.email, claude.plan && t('settings.aiAccounts.plan', { plan: claude.plan })].filter(Boolean).join(' · ') || t('claudeAccount.signedIn')
                            : t('settings.aiAccounts.claudeSignedOut')
                          : a.id === 'custom'
                            ? t('settings.aiAccounts.apiKey', { model: a.version ?? '' })
                            : (a.account ?? t('connection.notSignedIn'))}
                      </span>
                    </div>
                    {a.id !== 'custom' ? (
                      // Sign-ins (and sign-outs) of every agent are managed in one place: Agents › Provider.
                      <Button variant="secondary" small onClick={() => navigate({ name: 'agents', tab: 'provider' })}>
                        {t('settings.aiAccounts.manage')}
                      </Button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Button variant="secondary" small onClick={() => void removeApi()}>
                          {t('settings.apiRemove')}
                        </Button>
                        <Button variant="secondary" small onClick={() => setApiOpen(true)}>
                          {t('settings.apiChange')}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
            </Card>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <div className="mr-auto flex flex-col gap-1">
                <label htmlFor="share-install-stats" className="text-sm font-medium">
                  {t('settings.shareStats')}
                </label>
                <span className="text-xs text-text-3">{t('settings.shareStatsHint')}</span>
              </div>
              <Switch
                id="share-install-stats"
                checked={settings.shareInstallStats}
                aria-label={t('settings.shareStats')}
                onCheckedChange={(v) => void save({ shareInstallStats: v })}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
