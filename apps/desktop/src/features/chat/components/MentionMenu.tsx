import { useTranslation } from 'react-i18next';
import type { Project } from '@bspace-sdlc-app/shared';
import { i18n } from '@/i18n';
import { Command, CommandGroup, CommandItem, CommandList } from '@/shared/ui/primitives/command';

const meta = (p: Project) => i18n.t(`mention.status.${p.status}`);

export function filterProjects(projects: Project[], query: string): Project[] {
  const q = query.trim().toLowerCase();
  return q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects;
}

/** The menu's value for a feature. */
export const projectKey = (p: Pick<Project, 'id'>) => `project:${p.id}`;

/**
 * The list inside the @ popover: the features. The textarea keeps focus and drives `value` with the
 * arrow keys.
 */
export function MentionMenu({
  projects,
  query,
  value,
  onValueChange,
  onPick,
}: {
  projects: Project[];
  /** What was typed after @: an empty list then says nothing matches rather than that there is nothing. */
  query: string;
  value: string;
  onValueChange(key: string): void;
  onPick(p: Project): void;
}) {
  const { t } = useTranslation();
  return (
    <Command shouldFilter={false} value={value} onValueChange={onValueChange} className="bg-transparent">
      <CommandList aria-label={t('mention.aria')} className="max-h-[300px]">
        <CommandGroup heading={t('mention.videos')}>
          {projects.length === 0 && (
            <div className="px-2 py-3 text-[13px] text-text-3">{query.trim() ? t('mention.noVideosMatch') : t('mention.none')}</div>
          )}
          {projects.map((p) => (
            <CommandItem key={p.id} value={projectKey(p)} onSelect={() => onPick(p)} className="h-12 gap-3 px-2">
              <span aria-hidden="true" className="h-9 w-5 shrink-0 rounded-xs border border-hairline bg-raised" />
              <span className="flex min-w-0 flex-col text-left">
                <span className="truncate text-[13px] font-medium">{p.title}</span>
                <span className="text-xs text-text-3">{meta(p)}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2 text-xs text-text-3">
        {['↑', '↓'].map((k) => (
          <kbd key={k} className="rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-foreground">
            {k}
          </kbd>
        ))}
        <span>{t('mention.move')}</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-foreground">↵</kbd>
        <span>{t('mention.attach')}</span>
        <kbd className="ml-2 rounded-xs border border-hairline border-b-2 px-1 font-mono text-[11px] text-foreground">Esc</kbd>
        <span>{t('mention.close')}</span>
      </div>
    </Command>
  );
}
