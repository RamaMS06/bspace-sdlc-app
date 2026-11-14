import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, Archive, Bot, MessageCircle, Plus, Settings, Sparkles, Workflow } from 'lucide-react';
import type { RecentChat } from '@bspace-sdlc-app/shared';
import { UpdateBanner } from '@/features/updater';
import { Button } from '@/shared/ui/Button';
import { AllChats } from '@/app/layout/AllChats';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { listRecentChats, setThreadArchived } from '@/shared/lib/ipc';
import { recentChats, useChat, useJobs, useFolders } from '@/features/chat';
import { useApp, type Route } from '@/shared/state/app';
import { cn } from '@/shared/lib/utils';
import { useDevops } from '@/features/devops';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';

/** Recent shows this many; See all lists every chat. */
const RECENT = 10;
/** One more than Recent shows: Rust counts a project once, so an eleventh row means See all has more. */
const RECENT_FETCH = RECENT + 1;

type ChatStatus = 'working' | 'needs-you' | 'idle';
const DOT: Record<ChatStatus, string> = {
  working: 'animate-pulse bg-foreground motion-reduce:animate-none',
  'needs-you': 'bg-primary',
  idle: 'bg-text-3',
};

export type SidebarKey = 'chat' | 'workflow' | 'agents' | 'skills' | 'settings';

const NAV: { key: SidebarKey; icon: typeof AppWindow; route: Route }[] = [
  { key: 'chat', icon: Plus, route: { name: 'chat-new' } },
  { key: 'workflow', icon: Workflow, route: { name: 'workflow' } },
  { key: 'agents', icon: Bot, route: { name: 'agents' } },
  { key: 'skills', icon: Sparkles, route: { name: 'skills' } },
];

/** In the icon rail a control shows its name in a tooltip; in the full sidebar it shows it itself. */
function RailTip({ rail, label, children }: { rail: boolean; label: string; children: React.ReactElement }) {
  if (!rail) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NavItem({
  active,
  label,
  icon: Icon,
  onClick,
  count,
  badge,
  rail = false,
}: {
  active: boolean;
  label: string;
  icon: typeof AppWindow;
  onClick: () => void;
  count?: number;
  /** A word after the label (Soon); not on the rail. */
  badge?: string;
  rail?: boolean;
}) {
  // The rail shows the count as a dot: its number goes in the name and the tooltip.
  const railLabel = count !== undefined ? `${label} (${count})` : label;
  return (
    <RailTip rail={rail} label={railLabel}>
      <a
        href="#"
        role="link"
        aria-current={active ? 'page' : undefined}
        aria-label={rail ? railLabel : undefined}
        onClick={(e) => {
          e.preventDefault();
          onClick();
        }}
        className={cn(
          'relative flex h-8 items-center rounded-md text-[13px] font-medium no-underline transition-colors',
          rail ? 'w-9 justify-center' : 'gap-2.5 px-2.5',
          active
            ? 'bg-raised text-foreground shadow-[inset_0_1px_0_var(--color-border)]'
            : 'text-text-2 hover:bg-raised/50 hover:text-foreground',
        )}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
        {!rail && <span className="truncate">{label}</span>}
        {!rail && badge && ' '}
        {!rail && badge && (
          <span className="ml-auto rounded-full border border-hairline px-1.5 py-px text-[10px] font-medium text-text-3">{badge}</span>
        )}
        {count !== undefined &&
          (rail ? (
            <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
          ) : (
            <span className="ml-auto font-mono text-xs text-text-2">{count}</span>
          ))}
      </a>
    </RailTip>
  );
}

export function Sidebar({ active, collapsed = false }: { active: SidebarKey; collapsed?: boolean }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const needsYou = useApp((s) => s.needsYouCount);
  const version = useApp((s) => s.projectsVersion);
  const openChatId = useApp((s) => (s.route.name === 'chat' ? s.route.chatId : null));
  const streaming = useChat((s) => s.streaming);
  const permissions = useChat((s) => s.permissions);
  const jobs = useJobs((s) => s.jobs);
  const [recent, setRecent] = useState<RecentChat[]>([]);
  const [seeAll, setSeeAll] = useState(false);
  // A chat that starts or ends a turn moves up Recent.
  const running = Object.keys(streaming).filter((id) => streaming[id]).sort().join(' ');

  useEffect(() => {
    let alive = true;
    listRecentChats(RECENT_FETCH)
      .then((list) => alive && setRecent(recentChats(list)))
      .catch(() => alive && setRecent([]));
    return () => {
      alive = false;
    };
  }, [version, openChatId, running]);

  const status = (chatId: string): ChatStatus => {
    const waiting =
      !!permissions[chatId]?.length || jobs.some((j) => j.chatId === chatId && (j.status === 'needs-you' || j.status === 'failed'));
    return waiting ? 'needs-you' : streaming[chatId] ? 'working' : 'idle';
  };

  const openChat = (chat: RecentChat) => {
    // A row this session already has may be newer than the list (an agent switch since it was read).
    if (!useChat.getState().rows[chat.id]) useChat.getState().rememberChat(chat);
    setSeeAll(false);
    navigate({ name: 'chat', chatId: chat.id });
  };

  // Archived threads leave Recent (Settings › Archive brings them back); the open one closes.
  const archive = (chat: RecentChat) => {
    setRecent((list) => list.filter((c) => c.id !== chat.id));
    const route = useApp.getState().route;
    if (route.name === 'chat' && route.chatId === chat.id) navigate({ name: 'chat-new' });
    void setThreadArchived(chat.id, true)
      .catch(() => {})
      .finally(() => useApp.getState().bumpProjects());
  };

  // Chats in a folder group are listed there, not in Recent.
  const inFolder = useFolders((s) => s.byChat);

  const rail = collapsed;
  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label={t('sidebar.main')}
        data-collapsed={rail || undefined}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar pb-4 pt-3 text-foreground',
          rail ? 'items-center px-3' : 'px-3',
        )}
      >

        <div className="flex flex-col gap-buma-2xs">
          {NAV.map((n) => (
            <NavItem
              key={n.key}
              rail={rail}
              active={active === n.key}
              label={t(`sidebar.${n.key}` as 'sidebar.chat')}
              icon={n.icon}
              onClick={() => navigate(n.route)}
              count={n.key === 'workflow' && needsYou > 0 ? needsYou : undefined}
            />
          ))}
        </div>

        {!rail && <FolderGroups openChatId={openChatId} />}

        {!rail && (
          <div data-recent className="scrollbar-on-hover mt-4 flex min-h-0 flex-col gap-1 overflow-y-auto">
            <span className="px-2.5 pb-1 text-xs text-text-3">{t('sidebar.recent')}</span>
            {recent.filter((c) => !inFolder[c.id]).slice(0, RECENT).map((c) => {
              const st = status(c.id);
              const name = c.projectTitle ?? c.title;
              return (
                <div key={c.id} className="group relative flex shrink-0">
                  <a
                    href="#"
                    aria-current={openChatId === c.id ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      openChat(c);
                    }}
                    className={cn(
                      'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 text-[13px] text-foreground no-underline hover:bg-raised/50',
                      openChatId === c.id && 'bg-raised/50',
                      st !== 'working' && 'group-hover:pr-9 group-focus-within:pr-9',
                    )}
                  >
                    <span aria-hidden="true" data-status={st} className={cn('size-1.5 shrink-0 rounded-full', DOT[st])} />
                    <span className="truncate">{name}</span>
                    {st !== 'idle' && ' '}
                    {st !== 'idle' && <span className="sr-only">{t(st === 'working' ? 'sidebar.working' : 'sidebar.needsYou')}</span>}
                  </a>
                  {/* Not while its agent works: the turn would carry on out of sight. */}
                  {st !== 'working' && (
                    <button
                      type="button"
                      aria-label={t('sidebar.archive', { name })}
                      title={t('sidebar.archiveTip')}
                      onClick={() => archive(c)}
                      className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-text-3 opacity-0 hover:bg-raised hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                    >
                      <Archive size={14} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  )}
                </div>
              );
            })}
            {recent.length > RECENT && (
              <button
                type="button"
                onClick={() => setSeeAll(true)}
                className="flex h-7 shrink-0 cursor-pointer items-center rounded-md px-2.5 text-left text-[13px] text-text-3 hover:bg-raised/50 hover:text-foreground"
              >
                {t('sidebar.seeAll')}
              </button>
            )}
            <AllChats open={seeAll} onOpenChange={setSeeAll} onPick={openChat} />
          </div>
        )}

        <div className={cn('mt-auto flex shrink-0 flex-col gap-2 pt-3', rail && 'items-center')}>
          {!rail && <UpdateBanner />}
          <AccountRow rail={rail} settingsActive={active === 'settings'} />
        </div>
      </nav>
    </TooltipProvider>
  );
}

/** Two letters for an avatar: the first of the first and last name. */
export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/**
 * The sidebar footer, kept simple: who is signed in (the Azure DevOps account: initials, name and email or
 * organization; opens Settings › Account) and, on its right, the Settings button.
 */
function AccountRow({ rail, settingsActive }: { rail: boolean; settingsActive: boolean }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const profile = useDevops((s) => s.status?.profile ?? null);
  useEffect(() => {
    if (!useDevops.getState().status) void useDevops.getState().init().catch(() => {});
  }, []);
  const settings = (
    <RailTip rail={rail} label={t('sidebar.settings')}>
      <button
        type="button"
        data-testid="sidebar-settings"
        aria-label={t('sidebar.settings')}
        aria-current={settingsActive ? 'page' : undefined}
        title={rail ? undefined : t('sidebar.settings')}
        onClick={() => navigate({ name: 'settings' })}
        className={cn(
          'flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-2 hover:bg-raised hover:text-foreground',
          settingsActive && 'bg-raised text-foreground',
        )}
      >
        <Settings size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </RailTip>
  );
  if (!profile) return settings;
  const sub = profile.email ?? `dev.azure.com/${profile.org}`;
  const avatar = (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
      {initialsOf(profile.displayName)}
    </span>
  );
  const open = () => navigate({ name: 'settings', tab: 'account' });
  if (rail) {
    return (
      <>
        {settings}
        <RailTip rail label={profile.displayName}>
          <button type="button" aria-label={t('sidebar.account', { name: profile.displayName })} onClick={open} className="cursor-pointer border-0 bg-transparent p-0">
            {avatar}
          </button>
        </RailTip>
      </>
    );
  }
  return (
    <div className="flex w-full items-center gap-1 border-t border-border pt-2">
      <button
        type="button"
        data-testid="sidebar-account"
        aria-label={t('sidebar.account', { name: profile.displayName })}
        onClick={open}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-raised/50"
      >
        {avatar}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] font-medium text-foreground">{profile.displayName}</span>
          <span className="truncate text-[11px] text-text-3">{sub}</span>
        </span>
      </button>
      {settings}
    </div>
  );
}

/**
 * Folders attached to chats, as groups: the folder's name (show or hide its chats), and + to start a chat
 * already attached to it. Its chats are listed under it.
 */
function FolderGroups({ openChatId }: { openChatId: string | null }) {
  const { t } = useTranslation();
  const navigate = useApp((s) => s.navigate);
  const agent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const groups = useFolders((s) => s.groups);
  if (!groups.length) return null;
  const newChat = async (path: string) => {
    try {
      const id = await useFolders.getState().newChat(path, agent, t('sidebar.newChat'));
      navigate({ name: 'chat', chatId: id });
    } catch {
      /* the folder may be gone; nothing to open */
    }
  };
  return (
    <div data-folders className="mt-4 flex flex-col gap-1">
      <span className="px-2.5 pb-1 text-xs text-text-3">{t('sidebar.folders')}</span>
      {groups.map((g) => (
        <div key={g.path} className="flex flex-col gap-1">
          <div className="group relative flex">
            <button
              type="button"
              aria-expanded={g.open}
              title={g.path}
              onClick={() => useFolders.getState().toggle(g.path)}
              className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 pr-8 text-left text-[13px] font-medium text-foreground hover:bg-raised/50"
            >
              {g.open ? <ChevronDown size={13} aria-hidden="true" className="shrink-0 text-text-3" /> : <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-text-3" />}
              <Folder size={14} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-text-2" />
              <span className="truncate">{g.title}</span>
            </button>
            <button
              type="button"
              aria-label={t('sidebar.newChatIn', { name: g.title })}
              title={t('sidebar.newChatIn', { name: g.title })}
              onClick={() => void newChat(g.path)}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-text-3 hover:bg-raised hover:text-foreground"
            >
              <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          {g.open &&
            g.chats.map((c) => (
              <a
                key={c.id}
                href="#"
                aria-current={openChatId === c.id ? 'page' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate({ name: 'chat', chatId: c.id });
                }}
                className={cn(
                  'flex h-7 min-w-0 items-center rounded-md pr-2.5 pl-8 text-[13px] text-foreground no-underline hover:bg-raised/50',
                  openChatId === c.id && 'bg-raised/50',
                )}
              >
                <span className="truncate">{c.title}</span>
              </a>
            ))}
          {g.open && g.chats.length === 0 && <span className="pl-8 text-[12px] text-text-3">{t('sidebar.folderEmpty')}</span>}
        </div>
      ))}
    </div>
  );
}
