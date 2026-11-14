import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { ResizeHandle } from '@/components/ResizeHandle';
import { Sidebar, type SidebarKey } from '@/components/Sidebar';
import { StatusBar } from '@/components/StatusBar';
import { TitleBar } from '@/components/TitleBar';
import { VersionTag } from '@/components/VersionTag';
import { BumaLoading } from '@/components/buma/Loading';
import { setUiLanguage } from '@/i18n';
import { systemLanguage } from '@/lib/language';
import { getSettings, getSystemInfo, updateSettings } from '@/lib/ipc';
import { getVersion } from '@tauri-apps/api/app';
import { startAnalytics } from '@/lib/analytics';
import { startUpdateChecks } from '@/state/updater';
import { useWindowDrag } from '@/lib/windowDrag';
import { ChatRoute, useSoloChat } from '@/screens/ChatRoute';
import { Settings } from '@/screens/Settings';
import { Skills } from '@/screens/Skills';
import { Workflow } from '@/screens/Workflow';
import { Agents } from '@/screens/Agents';
import { Connect } from '@/screens/onboarding/Connect';
import { Requirements } from '@/screens/onboarding/Requirements';
import { AccountStep } from '@/screens/onboarding/AccountStep';
import { Welcome } from '@/screens/onboarding/Welcome';
import { useApp, type Route } from '@/state/app';
import { forceLight } from '@/lib/theme';
import { useDevops } from '@/state/devops';
import { SIDEBAR, useFittedLayout, useLayout, useSidebarShortcut, useWindowWidthSync } from '@/state/layout';
import { refreshJobs } from '@/state/jobs';

const ONBOARDING = new Set<Route['name']>(['welcome', 'connect', 'requirements', 'onboarding-account']);

const SIDEBAR_KEY: Partial<Record<Route['name'], SidebarKey>> = {
  'chat-new': 'chat',
  chat: 'chat',
  workflow: 'workflow',
  features: 'workflow',
  agents: 'agents',
  skills: 'skills',
  settings: 'settings',
};

function Onboarding({ name }: { name: Route['name'] }) {
  if (name === 'connect') return <Connect />;
  if (name === 'requirements') return <Requirements />;
  if (name === 'onboarding-account') return <AccountStep />;
  return <Welcome />;
}

export default function App() {
  const route = useApp((s) => s.route);
  const settings = useApp((s) => s.settings);
  const { t } = useTranslation();
  useWindowDrag();

  // Get started and the rest of onboarding are always white, dialogs included.
  const onboarding = ONBOARDING.has(route.name);
  useEffect(() => {
    forceLight(onboarding);
  }, [onboarding]);

  const [loadError, setLoadError] = useState(false);

  // First launch decides where to start: onboarded users go straight to a new chat.
  const load = useCallback(() => {
    setLoadError(false);
    getSettings()
      .then(async (st) => {
        // First run has no saved language: follow the system's. The language is set before the settings
        // so the first paint is already in it, and the store has it even if saving it fails.
        const lang = st.uiLanguage ?? (await systemLanguage());
        setUiLanguage(lang);
        useApp.getState().setSettings(st.uiLanguage ? st : { ...st, uiLanguage: lang });
        if (!st.uiLanguage) {
          void Promise.resolve()
            .then(() => updateSettings({ uiLanguage: lang }))
            // The user may have picked a language on Welcome meanwhile: that choice stands.
            .then((next) => next && useApp.getState().settings?.uiLanguage === lang && useApp.getState().setSettings(next))
            .catch(() => {});
        }
        // The app doesn't open without an Azure DevOps sign-in: back to the last onboarding step.
        const devops = st.onboarded ? await useDevops.getState().init().catch(() => null) : null;
        if (st.onboarded && !devops?.signedIn) {
          useApp.getState().navigate({ name: 'onboarding-account' });
        } else if (st.onboarded) {
          useApp.getState().navigate({ name: 'chat-new' });
          void refreshJobs().catch(() => {});
        }
      })
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Product analytics follow the "share anonymous stats" setting (see lib/analytics).
  const share = settings?.shareInstallStats;
  const installId = settings?.installId ?? '';
  const uiLanguage = settings?.uiLanguage ?? null;
  useEffect(() => {
    if (share === undefined) return;
    let alive = true;
    void Promise.all([
      Promise.resolve().then(() => getVersion()).catch(() => undefined),
      Promise.resolve().then(() => getSystemInfo()).then((s) => s.os).catch(() => undefined),
    ]).then(([appVersion, os]) => {
      if (alive) startAnalytics({ share, installId, appVersion, os, uiLanguage });
    });
    return () => {
      alive = false;
    };
  }, [share, installId, uiLanguage]);

  // Release builds look for a new version shortly after launch and every few hours.
  useEffect(() => startUpdateChecks(), []);


  if (!settings) {
    return (
      <div data-tauri-drag-region className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        {!loadError && <BumaLoading variant="process" />}
        {loadError && (
          <>
            <p className="m-0 text-sm text-text-2">{t('app.settingsFailed')}</p>
            <Button variant="secondary" onClick={load}>
              {t('common.tryAgain')}
            </Button>
          </>
        )}
      </div>
    );
  }

  if (onboarding) {
    return (
      <div className="light h-full overflow-y-auto bg-background">
        <Onboarding name={route.name} />
        <VersionTag floating />
      </div>
    );
  }
  return <Shell route={route} />;
}

/** Below the snap point a drag collapses the sidebar to its rail; above it, it opens at that width. */
function resizeSidebar(width: number, max: number, live?: boolean) {
  const layout = useLayout.getState();
  if (width < SIDEBAR.snap) return layout.setCollapsed(true, live);
  layout.setCollapsed(false, true);
  layout.setSidebar(Math.min(width, max), live);
}

/** The app around a screen: the resizable sidebar and the main column. */
function Shell({ route }: { route: Route }) {
  const { t } = useTranslation();
  // Only the project chat has the preview panel; the sidebar's room depends on it.
  const solo = useSoloChat(route.name === 'chat' ? route.chatId : null);
  const fitted = useFittedLayout(route.name === 'chat' && !solo);
  useWindowWidthSync();
  useSidebarShortcut();
  const sidebarHidden = useLayout((s) => s.sidebarHidden);
  const drawerOpen = useLayout((s) => s.drawerOpen);
  // A pick in the drawer (or Back/Forward) closes it.
  useEffect(() => {
    useLayout.getState().setDrawerOpen(false);
  }, [route]);

  return (
    // The window never scrolls as a page: each panel scrolls on its own.
    <div className="flex h-full flex-col overflow-hidden bg-background">
    <TitleBar />
    <div className="relative flex min-h-0 flex-1 overflow-hidden">
      {fitted.narrow ? (
        drawerOpen && (
          // A narrow window: the sidebar opens over the screen, and closes on a pick or a click outside.
          <div className="absolute inset-0 z-40 flex" data-testid="sidebar-drawer">
            <div id="app-sidebar" className="relative h-full w-[min(280px,85vw)] shrink-0 shadow-xl">
              <Sidebar active={SIDEBAR_KEY[route.name] ?? 'chat'} />
            </div>
            <button
              type="button"
              aria-label={t('titleBar.hideSidebar')}
              onClick={() => useLayout.getState().setDrawerOpen(false)}
              className="flex-1 cursor-default border-0 bg-black/30 p-0"
            />
          </div>
        )
      ) : (
        !sidebarHidden && (
          <div id="app-sidebar" className="relative h-full shrink-0" style={{ width: fitted.sidebar }}>
            <Sidebar active={SIDEBAR_KEY[route.name] ?? 'chat'} collapsed={fitted.collapsed} />
            <ResizeHandle
              label={t('layout.resizeSidebar')}
              side="right"
              aria-controls="app-sidebar"
              value={fitted.sidebar}
              min={SIDEBAR.min}
              ariaMin={SIDEBAR.rail}
              max={fitted.sidebarMax}
              onResize={(w, live) => resizeSidebar(w, fitted.sidebarMax, live)}
              onReset={() => useLayout.getState().resetSidebar()}
              onToggle={() => useLayout.getState().toggleCollapsed()}
            />
          </div>
        )
      )}
      <main className="relative min-w-0 flex-1">
        {route.name === 'chat-new' || route.name === 'chat' ? (
          <ChatRoute />
        ) : route.name === 'workflow' || route.name === 'features' ? (
          <Workflow />
        ) : route.name === 'agents' ? (
          <Agents />
        ) : route.name === 'skills' ? (
          <Skills />
        ) : (
          <Settings />
        )}
      </main>
      </div>
      <StatusBar />
    </div>
  );
}
