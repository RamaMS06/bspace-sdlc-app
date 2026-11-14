import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILTIN_SKILLS } from '@bspace-sdlc-app/skills';
import { listSkills } from '@/lib/ipc';
import { pluginsList } from '@/lib/plugins';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A skill the agent can be asked to use: the bundled bspace-sdlc-skills, then the user's own that are on. */
export interface SlashSkill {
  id: string;
  description: string;
  source: 'builtin' | 'mine';
  /** The plugin it comes from (for plugin skills). */
  plugin?: string;
}

/** The SDLC entry skill: the default route of every feature, marked with a star wherever skills are listed. */
export const ENTRY_SKILL = 'using-bspace-sdlc';

/** `/blue` at the start of the message (one word): the slash menu's query. */
export const SLASH = /^\/([\w:-]*)$/;

const BUNDLED: SlashSkill[] = BUILTIN_SKILLS.map((s) => ({ id: s.id, description: s.description, source: 'builtin' as const, plugin: 'bspace-sdlc-skills' }));

/** Every skill the agent has now: those of the plugins that are on (by plugin), then the user's own that are on. */
export function useSlashSkills(enabled: boolean): SlashSkill[] {
  const [fromPlugins, setFromPlugins] = useState<SlashSkill[] | null>(null);
  const [mine, setMine] = useState<SlashSkill[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    pluginsList()
      .then((list) => {
        if (!alive) return;
        setFromPlugins(
          list
            .filter((p) => p.enabled)
            .flatMap((p) => p.skills.map((s) => ({ id: s.id, description: s.description, source: 'builtin' as const, plugin: p.name }))),
        );
      })
      // Outside the app (or before Rust answers) the bundled plugin's skills stand in.
      .catch(() => alive && setFromPlugins(null));
    listSkills()
      .then((list) => alive && setMine(list.filter((s) => s.enabled).map((s) => ({ id: s.id, description: s.description, source: 'mine' as const }))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled]);
  const all = [...(fromPlugins ?? BUNDLED), ...mine];
  // The entry skill leads, whichever plugin lists it.
  return [...all.filter((x) => x.id === ENTRY_SKILL), ...all.filter((x) => x.id !== ENTRY_SKILL)];
}

export const filterSkills = (skills: SlashSkill[], query: string) => {
  const q = query.toLowerCase();
  return skills.filter((s) => s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
};

/**
 * The list shown above the message box while it starts with `/`: skill names only, the highlighted one
 * (pointer or arrow keys) with its description in a bubble beside it.
 */
export function SlashMenu({
  items,
  active,
  onPick,
  onActive,
}: {
  items: SlashSkill[];
  active: number;
  onPick(skill: SlashSkill): void;
  onActive?(index: number): void;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const current = items[active];

  // Keep the highlighted item in view, and the description bubble level with it.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!el || !list.current) return;
    el.scrollIntoView?.({ block: 'nearest' });
    setTop(el.offsetTop - list.current.scrollTop);
  }, [active, items.length]);

  return (
    <div className="relative w-fit">
      <div
        ref={list}
        role="listbox"
        aria-label={t('composer.slash.title')}
        onScroll={() => {
          const el = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
          if (el && list.current) setTop(el.offsetTop - list.current.scrollTop);
        }}
        className="max-h-80 w-64 overflow-y-auto rounded-2xl border border-hairline bg-popover p-1.5 shadow-lg"
      >
        {items.length === 0 ? (
          <p className="m-0 px-3 py-2 text-[13px] text-text-3">{t('composer.slash.none')}</p>
        ) : (
          items.map((s, i) => (
            <button
              key={`${s.source}-${s.id}`}
              type="button"
              role="option"
              data-index={i}
              aria-selected={i === active}
              title={s.description}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onActive?.(i)}
              onClick={() => onPick(s)}
              className={cn(
                'flex h-9 w-full cursor-pointer items-center rounded-xl border-0 bg-transparent px-3 text-left text-[14px] text-foreground',
                i === active && 'bg-raised',
              )}
            >
              {s.id === ENTRY_SKILL ? (
                <Star data-testid="entry-star" size={13} fill="currentColor" aria-hidden="true" className="mr-2 shrink-0 text-warning" />
              ) : (
                // Keeps every name on the same left edge as the starred one.
                <span aria-hidden="true" className="mr-2 inline-block size-[13px] shrink-0" />
              )}
              <span className="truncate">{s.id}</span>
            </button>
          ))
        )}
      </div>
      {current?.description && (
        <div
          aria-hidden="true"
          data-testid="slash-hint"
          style={{ top }}
          className="pointer-events-none absolute left-full z-10 ml-2 w-64 max-md:hidden rounded-lg border border-hairline bg-popover px-3 py-2 text-[13px] leading-snug text-foreground shadow-md"
        >
          {current.id === ENTRY_SKILL && <span className="mb-1 block text-[11px] font-medium text-warning">{t('composer.slash.entry')}</span>}
          <span className="line-clamp-4">{current.description}</span>
          <span className="mt-1 block font-mono text-[11px] text-text-3">{current.source === 'mine' ? t('composer.slash.mine') : current.plugin}</span>
        </div>
      )}
    </div>
  );
}
