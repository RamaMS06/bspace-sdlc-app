import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, GripVertical, Plus, Star, Trash2, X } from 'lucide-react';
import type { AgentId, AgentInfo } from '@bspace-sdlc-app/shared';
import { AgentLogo } from '@/shared/ui/AgentLogo';
import { Button } from '@/shared/ui/Button';
import { BumaBadge } from '@/shared/ui/buma/Badge';
import { groupModels, useModelChoices } from '@/features/agents/components/FailoverCard';
import { Input } from '@/shared/ui/primitives/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Switch } from '@/shared/ui/primitives/switch';
import { AGENT_NAMES } from '@/shared/lib/agents';
import { cn } from '@/shared/lib/utils';
import { stepKey, useFailover, type Combo, type Step } from '@/features/agents/state/failover';
import { useModels } from '@/features/agents/state/models';

const iconBtn =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-text-3 hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent';

/** A model's name for people: the one its agent or the full list gives, else its id. */
export function useModelName(agent: AgentId) {
  const choices = useModelChoices(agent);
  return (model: string | null, fallback: string) => (model ? (choices.find((m) => m.value === model)?.name ?? model.split('/').pop() ?? model) : fallback);
}

/** One agent's models in the step menu, grouped by family, filtered by what was typed. */
function AgentModels({ agent, query, onPick }: { agent: AgentId; query: string; onPick(step: Step): void }) {
  const { t } = useTranslation();
  const q = query.trim().toLowerCase();
  const choices = useModelChoices(agent).filter((m) => !q || m.value.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || AGENT_NAMES[agent].toLowerCase().includes(q));
  const showDefault = !q || t('composer.modelDefault').toLowerCase().includes(q) || AGENT_NAMES[agent].toLowerCase().includes(q);
  if (!choices.length && !showDefault) return null;
  return (
    <div role="group" aria-label={AGENT_NAMES[agent]} className="flex flex-col">
      <span className="sticky top-0 z-[1] flex items-center gap-buma-xs bg-popover px-buma-xs pt-buma-xs pb-buma-2xs text-[11px] font-medium text-text-2">
        <AgentLogo id={agent} size={13} />
        {AGENT_NAMES[agent]}
      </span>
      {showDefault && (
        <button type="button" onClick={() => onPick({ agent, model: null })} className="cursor-pointer rounded-md border-0 bg-transparent px-buma-xs py-1.5 text-left text-[13px] text-text-2 hover:bg-raised">
          {t('composer.modelDefault')}
        </button>
      )}
      {groupModels(agent, choices).flatMap((g) =>
        g.items.map((m) => (
          <button
            key={m.value}
            type="button"
            title={m.value}
            onClick={() => onPick({ agent, model: m.value })}
            className="flex cursor-pointer items-baseline justify-between gap-buma-xs rounded-md border-0 bg-transparent px-buma-xs py-1.5 text-left text-[13px] hover:bg-raised"
          >
            <span className="truncate">{m.name}</span>
            {m.name !== m.value && (
              <span aria-hidden="true" className="truncate font-mono text-[10px] text-text-3">
                {m.value}
              </span>
            )}
          </button>
        )),
      )}
    </div>
  );
}

/**
 * Picks one model of any connected agent: a search box, then each agent's models (every version), with
 * the agent's default model first. Used for a combo's steps.
 */
export function StepPicker({ agents, onPick, children }: { agents: AgentId[]; onPick(step: Step): void; children: React.ReactElement }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openMenu = (o: boolean) => {
    setOpen(o);
    if (!o) return setQuery('');
    for (const a of agents) {
      void useModels.getState().loadCatalog(a);
      void useModels.getState().load(a);
    }
  };
  return (
    <Popover open={open} onOpenChange={openMenu}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="flex w-[min(340px,calc(100vw-2rem))] flex-col gap-buma-2xs p-buma-xs">
        <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('combos.search')} aria-label={t('combos.search')} className="h-8 text-[12px]" />
        <div data-testid="step-menu" className="flex max-h-80 flex-col gap-buma-xs overflow-y-auto">
          {agents.length === 0 && <span className="px-buma-xs py-buma-xs text-[12px] text-text-3">{t('combos.noAgents')}</span>}
          {agents.map((a) => (
            <AgentModels
              key={a}
              agent={a}
              query={query}
              onPick={(s) => {
                onPick(s);
                openMenu(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Where a dragged row would land: how many of the other rows have their middle above the pointer. */
export function dropIndex(mids: number[], from: number, y: number): number {
  return mids.reduce((n, mid, i) => (i !== from && mid < y ? n + 1 : n), 0);
}

/** `from` moved to `to`, the rest keeping their order. */
export function moveStep<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

function StepRow({
  step,
  index,
  count,
  drag,
  onGrab,
  onMove,
  onRemove,
}: {
  step: Step;
  index: number;
  count: number;
  /** While a row is being dragged: which one, and where it would land. */
  drag: { from: number; to: number } | null;
  onGrab(index: number, e: React.PointerEvent<HTMLElement>): void;
  onMove(by: -1 | 1): void;
  onRemove(): void;
}) {
  const { t, i18n } = useTranslation();
  const name = useModelName(step.agent);
  useFailover((s) => s.cooldown);
  const until = useFailover.getState().restingUntil(step);
  const label = `${AGENT_NAMES[step.agent]} · ${name(step.model, t('composer.modelDefault'))}`;
  const dragging = drag?.from === index;
  // The line where the dragged row would land: below the row it moves down past, above the one it moves up past.
  const line = drag && !dragging && index === drag.to && drag.to !== drag.from ? (drag.to > drag.from ? 'bottom' : 'top') : null;
  return (
    <li
      data-testid={`step-${stepKey(step)}`}
      data-step-index={index}
      className={cn(
        'relative flex items-center gap-buma-xs rounded-md px-buma-xs py-buma-2xs hover:bg-raised/50',
        dragging && 'bg-raised opacity-70 shadow-md',
        line === 'top' && 'before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:rounded-full before:bg-primary',
        line === 'bottom' && 'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary',
      )}
    >
      <button
        type="button"
        data-testid={`grip-${index}`}
        aria-label={t('combos.drag', { name: label })}
        title={t('combos.dragHint')}
        onPointerDown={(e) => onGrab(index, e)}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded border-0 bg-transparent text-text-3 hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical size={14} aria-hidden="true" />
      </button>
      <span className="w-4 shrink-0 text-center font-mono text-[11px] text-text-3">{index + 1}</span>
      <AgentLogo id={step.agent} size={16} />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {AGENT_NAMES[step.agent]}
        <span className="text-text-2"> · {name(step.model, t('composer.modelDefault'))}</span>
      </span>
      {until > 0 && (
        <BumaBadge variant="draft" label={t('settings.failover.resting', { time: new Date(until).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) })} />
      )}
      <button type="button" className={iconBtn} disabled={index === 0} aria-label={t('settings.failover.up', { name: label })} onClick={() => onMove(-1)}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" className={iconBtn} disabled={index === count - 1} aria-label={t('settings.failover.down', { name: label })} onClick={() => onMove(1)}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" className={iconBtn} aria-label={t('combos.removeStep', { name: label })} onClick={onRemove}>
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

function ComboCard({ combo, agents, isDefault, canRemove }: { combo: Combo; agents: AgentId[]; isDefault: boolean; canRemove: boolean }) {
  const { t } = useTranslation();
  const fo = useFailover.getState();
  const [name, setName] = useState(combo.name);
  const steps = combo.steps;
  const list = useRef<HTMLOListElement>(null);
  // Dragging a row by its grip (pointer events: they work in every webview, unlike HTML5 drag and drop,
  // which Tauri's file-drop handling takes over on Windows).
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const grab = (index: number, e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag({ from: index, to: index });
    const rows = () => [...(list.current?.querySelectorAll<HTMLElement>('[data-step-index]') ?? [])];
    const over = (y: number) => {
      const mids = rows().map((r) => {
        const b = r.getBoundingClientRect();
        return b.top + b.height / 2;
      });
      setDrag((d) => (d ? { ...d, to: dropIndex(mids, d.from, y) } : d));
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      const d = dragRef.current;
      setDrag(null);
      if (commit && d && d.from !== d.to) useFailover.getState().setComboSteps(combo.id, moveStep(stepsRef.current, d.from, d.to));
    };
    const move = (ev: PointerEvent) => over(ev.clientY);
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  };
  // A combo that goes away mid-drag leaves nothing listening (the listeners remove themselves on release).
  useEffect(() => () => setDrag(null), []);
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    fo.setComboSteps(combo.id, next);
  };
  return (
    <section data-testid={`combo-${combo.id}`} aria-label={combo.name} className="flex flex-col gap-buma-xs rounded-xl border border-border bg-card p-buma-sm">
      <div className="flex items-center gap-buma-xs">
        <button
          type="button"
          aria-pressed={isDefault}
          aria-label={isDefault ? t('combos.isDefault', { name: combo.name }) : t('combos.makeDefault', { name: combo.name })}
          title={isDefault ? t('combos.isDefault', { name: combo.name }) : t('combos.makeDefault', { name: combo.name })}
          onClick={() => fo.setDefaultCombo(combo.id)}
          className={cn(iconBtn, isDefault && 'text-warning')}
        >
          <Star size={15} fill={isDefault ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name.trim() !== combo.name ? fo.renameCombo(combo.id, name.trim()) : setName(combo.name)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label={t('combos.name')}
          className="h-8 max-w-[260px] border-transparent bg-transparent px-buma-xs text-[14px] font-medium shadow-none hover:border-border focus-visible:border-border"
        />
        {isDefault && <BumaBadge variant="success" label={t('settings.route.default')} />}
        <span className="ml-auto text-[11px] text-text-3">{steps.length === 1 ? t('combos.single') : t('combos.steps', { count: steps.length })}</span>
        {canRemove && (
          <button type="button" className={iconBtn} aria-label={t('combos.remove', { name: combo.name })} onClick={() => fo.removeCombo(combo.id)}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {steps.length > 0 ? (
        <ol ref={list} aria-label={t('combos.stepsAria', { name: combo.name })} className="m-0 flex list-none flex-col gap-buma-2xs p-0">
          {steps.map((s, i) => (
            <StepRow
              key={`${stepKey(s)}-${i}`}
              step={s}
              index={i}
              count={steps.length}
              drag={drag}
              onGrab={grab}
              onMove={(by) => move(i, by)}
              onRemove={() => fo.setComboSteps(combo.id, steps.filter((_, k) => k !== i))}
            />
          ))}
        </ol>
      ) : (
        <span className="px-buma-xs text-[12px] text-text-3">{t('combos.empty')}</span>
      )}
      <StepPicker agents={agents} onPick={(step) => fo.setComboSteps(combo.id, [...steps, step])}>
        <button
          type="button"
          className="inline-flex h-7 w-fit cursor-pointer items-center gap-1 rounded-[5px] border border-dashed border-border bg-transparent px-buma-xs text-[12px] text-text-2 hover:border-primary hover:text-primary-text"
        >
          <Plus size={12} aria-hidden="true" />
          {t('combos.addStep')}
        </button>
      </StepPicker>
    </section>
  );
}

/**
 * Agents › Combo: named lists of models a chat runs on, picked per chat under the message box. A combo
 * can be one model or several in order (the chat moves down it when one hits a limit); the starred one
 * is what new chats use. Steps come from the agents connected in Provider.
 */
export function CombosTab({ agents }: { agents: AgentInfo[] }) {
  const { t } = useTranslation();
  const combos = useFailover((s) => s.combos);
  const defaultCombo = useFailover((s) => s.defaultCombo);
  const on = useFailover((s) => s.on);
  const ready = agents.filter((a) => a.installed && a.id !== 'custom').map((a) => a.id);
  const add = () => useFailover.getState().addCombo(t('combos.newName', { n: combos.length + 1 }));
  return (
    <div className="flex flex-col gap-buma-sm">
      <div className="flex flex-wrap items-center gap-buma-sm rounded-xl border border-border bg-card px-buma-md py-buma-sm">
        <div className="mr-auto flex min-w-0 flex-[1_1_240px] flex-col gap-buma-2xs">
          <span className="text-sm font-medium">{t('combos.title')}</span>
          <span className="text-xs text-text-3">{t('combos.hint')}</span>
        </div>
        <span className="text-[12px] text-text-2">{t('settings.route.failover')}</span>
        <Switch checked={on} aria-label={t('settings.failover.toggle')} onCheckedChange={(v) => useFailover.getState().setOn(v)} />
        <Button variant="secondary" className="gap-1.5" onClick={add}>
          <Plus size={14} aria-hidden="true" />
          {t('combos.new')}
        </Button>
      </div>
      {combos.map((c) => (
        <ComboCard key={c.id} combo={c} agents={ready} isDefault={c.id === defaultCombo} canRemove={combos.length > 1} />
      ))}
    </div>
  );
}
