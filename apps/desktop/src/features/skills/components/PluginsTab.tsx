import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { ChevronDown, ChevronRight, FileArchive, FolderOpen, Link, Package, Plus, TriangleAlert, Star } from 'lucide-react';
import { BumaBadge } from '@/shared/ui/buma/Badge';
import { ENTRY_SKILL } from '@/features/skills/components/SlashMenu';
import { Button } from '@/shared/ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/primitives/dropdown-menu';
import { Input } from '@/shared/ui/primitives/input';
import { Switch } from '@/shared/ui/primitives/switch';
import { pickFolder } from '@/shared/lib/ipc';
import {
  pluginDiscard,
  pluginInstall,
  pluginRemove,
  pluginSetEnabled,
  pluginStageFolder,
  pluginStageGithub,
  pluginStageZip,
  pluginsList,
  type PluginInfo,
  type StagedPlugins,
} from '@/features/skills/lib/plugins';
import { cn } from '@/shared/lib/utils';
import { useIsAdmin } from '@/features/devops';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One plugin: its name, version, where it comes from, an on/off switch, and its skills folded away. */
function PluginCard({
  plugin,
  replacedBy,
  admin,
  onToggle,
  onRemove,
}: {
  plugin: PluginInfo;
  replacedBy?: PluginInfo;
  /** An admin edits plugins; everyone else only reads and uses them. */
  admin: boolean;
  onToggle(on: boolean): void;
  onRemove(): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const updatesBundled = plugin.source === 'installed' && plugin.name === replacedBy?.name;
  return (
    <article data-testid={`plugin-${plugin.name}-${plugin.source}`} className={cn('flex flex-col rounded-xl border border-border bg-card', plugin.replaced && 'opacity-70')}>
      <div className="flex items-start gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-raised text-text-2">
          <Package size={18} strokeWidth={1.5} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[14px] font-medium">{plugin.name}</span>
            {plugin.version && <span className="font-mono text-[11px] text-text-3">v{plugin.version}</span>}
            {plugin.source === 'bundled' ? (
              <BumaBadge variant="neutral" label={t('plugins.bundled')} />
            ) : updatesBundled ? (
              <BumaBadge variant="draft" label={t('plugins.update')} />
            ) : (
              <BumaBadge variant="success" label={t('plugins.installed')} />
            )}
          </span>
          {plugin.description && <span className="line-clamp-2 text-[13px] text-text-2">{plugin.description}</span>}
          {plugin.replaced && <span className="text-[12px] text-text-3">{t('plugins.replacedNote')}</span>}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-text-2 hover:text-foreground"
          >
            {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            {t('plugins.skillsCount', { count: plugin.skills.length })}
            {plugin.hooks.length > 0 && <span className="text-text-3"> · {t('plugins.hooksCount', { count: plugin.hooks.length })}</span>}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {admin && plugin.source === 'installed' && (
            <Button variant="secondary" small onClick={onRemove}>
              {updatesBundled ? t('plugins.useBundled') : t('plugins.remove')}
            </Button>
          )}
          <Switch
            checked={plugin.enabled}
            disabled={plugin.replaced || !admin}
            aria-label={t('plugins.toggle', { name: plugin.name })}
            onCheckedChange={onToggle}
          />
        </div>
      </div>
      {open && (
        <ul className="m-0 flex list-none flex-col gap-2 border-t border-border p-4 pt-3">
          {plugin.skills.map((s) => (
            <li key={s.id} className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-mono text-[12px] font-medium">
                {s.id === ENTRY_SKILL && <Star data-testid="entry-star" size={12} fill="currentColor" aria-label={t('composer.slash.entry')} className="shrink-0 text-warning" />}
                {s.id}
              </span>
              <span className="line-clamp-2 text-[12px] text-text-3">{s.description}</span>
            </li>
          ))}
          {plugin.hooks.map((h) => (
            <li key={h} className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
              <TriangleAlert size={12} aria-hidden="true" className="shrink-0" />
              {h}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** What an install found: its skills and the hook commands it would run, before anything is used. */
function InstallDialog({ staged, busy, onCancel, onInstall }: { staged: StagedPlugins | null; busy: boolean; onCancel(): void; onInstall(): void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!staged} onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{t('plugins.installTitle', { count: staged?.plugins.length ?? 0 })}</DialogTitle>
          <DialogDescription>{t('plugins.installBody')}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
          {staged?.plugins.map((p) => (
            <section key={p.name} aria-label={p.name} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <span className="flex items-center gap-2">
                <span className="font-mono text-[14px] font-medium">{p.name}</span>
                {p.version && <span className="font-mono text-[11px] text-text-3">v{p.version}</span>}
              </span>
              <span className="text-[12px] text-text-2">{t('plugins.skillsCount', { count: p.skills.length })}: {p.skills.map((s) => s.id).join(', ')}</span>
              {p.hooks.length > 0 && (
                <div role="note" className="flex flex-col gap-1 rounded-md bg-warning-soft p-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-warning">
                    <TriangleAlert size={13} aria-hidden="true" />
                    {t('plugins.hooksWarn')}
                  </span>
                  {p.hooks.map((h) => (
                    <code key={h} className="font-mono text-[11px] break-all">
                      {h}
                    </code>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy} onClick={onInstall}>
            {busy ? t('plugins.installing') : t('plugins.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Skills screen's Plugins tab, like Claude Desktop's: the bundled bspace-sdlc-skills plugin and the
 * ones installed from a folder, a .zip or a GitHub link, each folded to one card with an on/off switch.
 * Installing a plugin named like the bundled one updates it as is; removing that goes back to the
 * bundled version. New chats load the plugins that are on.
 */
export function PluginsTab() {
  const { t } = useTranslation();
  const admin = useIsAdmin();
  const [plugins, setPlugins] = useState<PluginInfo[] | null>(null);
  const [staged, setStaged] = useState<StagedPlugins | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [github, setGithub] = useState<string | null>(null);

  const load = useCallback(() => {
    pluginsList()
      .then(setPlugins)
      .catch((e) => {
        setPlugins([]);
        setError(errorText(e));
      });
  }, []);
  useEffect(load, [load]);

  const run = async (task: () => Promise<StagedPlugins | PluginInfo[] | void>) => {
    setError(null);
    setBusy(true);
    try {
      const out = await task();
      if (Array.isArray(out)) setPlugins(out);
      else if (out) setStaged(out);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const fromFolder = () =>
    run(async () => {
      const path = await pickFolder();
      return path ? pluginStageFolder(path) : undefined;
    });
  const fromZip = () =>
    run(async () => {
      const path = await openDialog({ multiple: false, directory: false, filters: [{ name: 'Zip', extensions: ['zip'] }] });
      return typeof path === 'string' ? pluginStageZip(path) : undefined;
    });
  const fromGithub = (e: FormEvent) => {
    e.preventDefault();
    const url = github?.trim();
    if (!url) return;
    setGithub(null);
    void run(() => pluginStageGithub(url));
  };

  const bundled = plugins?.find((p) => p.source === 'bundled');

  return (
    <section aria-label={t('plugins.title')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="mr-auto text-[13px] text-text-2">{t('plugins.intro')}</span>
        {admin ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button disabled={busy} className="gap-1.5">
                <Plus size={14} aria-hidden="true" />
                {t('plugins.add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => void fromFolder()}>
                <FolderOpen size={15} strokeWidth={1.5} aria-hidden="true" />
                {t('plugins.fromFolder')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void fromZip()}>
                <FileArchive size={15} strokeWidth={1.5} aria-hidden="true" />
                {t('plugins.fromZip')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setGithub('')}>
                <Link size={15} strokeWidth={1.5} aria-hidden="true" />
                {t('plugins.fromGithub')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <BumaBadge variant="neutral" label={t('plugins.adminsOnly')} />
        )}
      </div>

      {!admin && (
        <p role="note" data-testid="plugins-admin-note" className="m-0 rounded-md bg-raised/60 px-3 py-2 text-[13px] text-text-2">
          {t('plugins.adminNote')}
        </p>
      )}

      {admin && github !== null && (
        <form onSubmit={fromGithub} className="flex gap-2 rounded-xl border border-border bg-card p-3">
          <Input
            autoFocus
            value={github}
            onChange={(e) => setGithub(e.target.value)}
            // i18n-ignore: an example URL
            placeholder="https://github.com/owner/repo"
            aria-label={t('plugins.githubLink')}
          />
          <Button type="button" variant="secondary" onClick={() => setGithub(null)}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!github.trim()}>
            {t('plugins.check')}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="m-0 rounded-md border border-error/40 px-3 py-2 text-[13px] text-error">
          {error}
        </p>
      )}

      {plugins?.map((p) => (
        <PluginCard
          key={`${p.source}-${p.name}`}
          plugin={p}
          admin={admin}
          replacedBy={bundled}
          onToggle={(on) => void run(() => pluginSetEnabled(p.name, on))}
          onRemove={() => void run(() => pluginRemove(p.name))}
        />
      ))}
      {plugins?.length === 0 && <p className="m-0 text-[13px] text-text-3">{t('plugins.none')}</p>}

      <InstallDialog
        staged={staged}
        busy={busy}
        onCancel={() => {
          if (staged) void pluginDiscard(staged.id).catch(() => {});
          setStaged(null);
        }}
        onInstall={() => {
          const id = staged?.id;
          if (!id) return;
          void run(async () => {
            const list = await pluginInstall(id);
            setStaged(null);
            return list;
          });
        }}
      />
    </section>
  );
}
