import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { ArrowUp, AtSign, Check, ChevronDown, Star, File as FileIcon, Folder, FolderPlus, Paperclip, Plus, Slash, Square, X } from 'lucide-react';
import type { AgentId, MessagePart, Project } from '@bspace-sdlc-app/shared';
import { Button } from '@/components/Button';
import { AgentLogo } from '@/components/AgentLogo';
import { filterProjects, MentionMenu, projectKey } from '@/components/MentionMenu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { groupModels } from '@/components/FailoverCard';
import { KNOWN_MODELS, parseSingle, singlePick, useFailover } from '@/state/failover';
import { StepPicker, useModelName } from '@/components/Combos';
import { usePick } from '@/lib/route';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AGENT_NAMES } from '@/lib/agents';
import { assetUrl, attachFile, setAgentModel } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useApp } from '@/state/app';
import { autoOn, modeOf, useChat } from '@/state/chat';
import { EXACT_LIST, modelOptions, useModels } from '@/state/models';
import { BumaLoading } from '@/components/buma/Loading';
import { ModePicker } from '@/components/ModePicker';
import { SLASH, SlashMenu, filterSkills, useSlashSkills, type SlashSkill } from '@/components/SlashMenu';
import { folderTitle, useFolders } from '@/state/folders';
import { pickFolder } from '@/lib/ipc';
import { track } from '@/lib/analytics';

export const QUICK_CHIPS = ['faster', 'bigger', 'colors', 'music', 'short'] as const;

const TOKEN = /(^|\s)@(\S*)$/;
const NONE: MessagePart[] = [];

type FilePart = Extract<MessagePart, { type: 'file' }>;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface MentionRef {
  projectId: string;
  title: string;
}

function FileChip({ part, onRemove }: { part: FilePart; onRemove(): void }) {
  const { t } = useTranslation();
  const image = part.mime.startsWith('image/');
  return (
    <span className="inline-flex h-8 max-w-60 items-center gap-2 rounded-sm border border-hairline bg-transparent pl-2 pr-1 text-xs text-text-2">
      {image ? (
        <img src={assetUrl(part.path)} alt={part.name} className="size-5 shrink-0 rounded-[4px] object-cover" />
      ) : (
        <FileIcon size={14} strokeWidth={1.5} className="shrink-0" aria-hidden="true" />
      )}
      <span className="truncate font-medium text-foreground">{part.name}</span>
      <span className="shrink-0 font-mono text-text-3">{fileSize(part.size)}</span>
      <button
        type="button"
        aria-label={t('composer.removeFile')}
        onClick={onRemove}
        className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-text-3"
      >
        <X size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </span>
  );
}


/** Every toolbar control: a 32×32 icon button, same radius and hover. */
/** No queued messages: one shared empty list, so the selector stays stable. */
const NO_QUEUE: never[] = [];

/** The tallest the message field grows before it scrolls. */
const MAX_FIELD = 200;

const ICON_BUTTON =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border-none bg-transparent p-0 text-text-2 transition-colors hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-50';

/** A toolbar control with its full label as a tooltip. */
function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * What this chat runs on, under the message box: a combo (Agents › Combo) or one model on its own,
 * picked per chat. The button names the pick and the model in use; the menu lists the combos (the
 * starred one is for new chats), then every model of the connected agents, and links to the combos.
 */
function ComboPicker({ agent, chatId }: { agent: AgentId; chatId: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const pick = useFailover((s) => s.pickOf(chatId));
  const combos = useFailover((s) => s.combos);
  const defaultCombo = useFailover((s) => s.defaultCombo);
  const ready = useFailover((s) => s.ready);
  const live = useModels((s) => (chatId ? (s.byChat[chatId]?.current ?? null) : null));
  const picked = useApp((s) => s.settings?.agentModels?.[agent] ?? null);
  const name = useModelName(agent);
  const single = parseSingle(pick);
  const combo = single ? null : combos.find((c) => c.id === pick);
  const model = live ?? picked;
  const title = combo ? combo.name : single ? `${AGENT_NAMES[single.agent]} · ${name(single.model, t('composer.modelDefault'))}` : AGENT_NAMES[agent];
  const agents = (ready.length ? ready : [agent]).filter((a) => a !== 'custom');
  const choose = (next: string) => {
    setOpen(false);
    void usePick(chatId, next, chatId ? agent : null);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={t('combos.pickAria', { name: title })}>
        <PopoverTrigger asChild>
          <button type="button" data-testid="route-badge" aria-label={t('combos.pickAria', { name: title })} className={cn(ICON_BUTTON, 'w-auto min-w-8 px-2.5')}>
            <AgentLogo id={agent} size={16} />
            <span className="max-w-32 truncate text-[12px]">{title}</span>
            {combo && <span className="max-w-32 truncate text-[12px] text-text-3">· {name(model, AGENT_NAMES[agent])}</span>}
            <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent side="top" align="start" className="flex w-[min(340px,calc(100vw-2rem))] flex-col gap-buma-xs border-hairline bg-card p-buma-xs">
        <span className="px-buma-xs pt-buma-2xs text-[11px] font-medium tracking-[0.04em] text-text-3 uppercase">{t('combos.pickTitle')}</span>
        <ul aria-label={t('combos.pickTitle')} className="m-0 flex list-none flex-col p-0">
          {combos.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-current={c.id === pick ? 'true' : undefined}
                onClick={() => choose(c.id)}
                className={cn('flex w-full cursor-pointer items-center gap-buma-xs rounded-md border-0 bg-transparent px-buma-xs py-1.5 text-left text-[13px] hover:bg-raised', c.id === pick && 'bg-primary-soft')}
              >
                <Star size={13} aria-hidden="true" fill={c.id === defaultCombo ? 'currentColor' : 'none'} className={cn('shrink-0', c.id === defaultCombo ? 'text-warning' : 'text-transparent')} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-[11px] text-text-3">{c.steps.length === 1 ? t('combos.single') : t('combos.steps', { count: c.steps.length })}</span>
                {c.id === pick && <Check size={13} aria-hidden="true" className="text-primary" />}
              </button>
            </li>
          ))}
        </ul>
        <StepPicker agents={agents} onPick={(s) => choose(singlePick(s.agent, s.model))}>
          <button type="button" className="flex cursor-pointer items-center justify-between rounded-md border-0 bg-transparent px-buma-xs py-1.5 text-left text-[13px] text-text-2 hover:bg-raised">
            <span>{single ? title : t('combos.singleTitle')}</span>
            <ChevronDown size={12} aria-hidden="true" className="-rotate-90" />
          </button>
        </StepPicker>
        <Button
          variant="secondary"
          small
          className="self-start"
          onClick={() => {
            setOpen(false);
            useApp.getState().navigate({ name: 'agents', tab: 'combo' });
          }}
        >
          {t('combos.manage')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** A model value's readable tail when the agent gave no name for it ("opencode/big-pickle" → "big-pickle"). */
const shortModel = (value: string) => value.split('/').pop() ?? value;

/** A model's name in the picker. Your API has one provider, so its "Provider/" prefix says nothing. */
const modelName = (agent: AgentId, name: string) => (agent === 'custom' ? shortModel(name) : name);

/**
 * The agent's model: what the chat's session runs on, or the one picked for the agent, else its
 * default. Picking one saves it for the agent (later sessions start on it) and switches the chat's
 * running session now. The list comes from the agent itself; before any session it is asked once.
 */
export function ModelPicker({ agent, chatId, disabled }: { agent: AgentId; chatId: string | null; disabled?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A pick is being applied (the running session switches, or the agent starts on it).
  const [switching, setSwitching] = useState(false);
  const picked = useApp((s) => s.settings?.agentModels?.[agent] ?? null);
  const live = useModels((s) => (chatId ? (s.byChat[chatId]?.current ?? null) : null));
  const session = useModels((s) => modelOptions(s, agent, chatId));
  const catalog = useModels((s) => s.catalog[agent]);
  const catalogLoading = useModels((s) => !!s.catalogLoading[agent]);
  const extra = useFailover((s) => s.extra[agent]);
  // Every model of the agent: its own list (shortcuts such as Sonnet or Opus), then every version from the
  // full list (Claude: Anthropic's; opencode: all providers), then the ones added by hand.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const own = catalog?.length && EXACT_LIST.includes(agent) ? [] : session;
    return [...own, ...(catalog ?? []), ...(catalog?.length ? [] : (KNOWN_MODELS[agent] ?? [])), ...(extra ?? []).map((value) => ({ value, name: value }))].filter(
      (m) => m.value !== 'default' && !seen.has(m.value) && !!seen.add(m.value),
    );
  }, [session, catalog, extra, agent]);
  const loading = useModels((s) => !!s.loading[agent]) || catalogLoading;
  const failed = useModels((s) => s.failed[agent] ?? null);
  useEffect(() => useModels.getState().listen(), []);

  const current = live ?? picked;
  // The agent's own entries first, then every version grouped by family.
  const groups = useMemo(() => {
    const g = groupModels(agent, options);
    return [...g.filter((x) => x.family === null), ...g.filter((x) => x.family !== null)];
  }, [agent, options]);
  const found = current ? options.find((o) => o.value === current) : undefined;
  const label = current ? (found ? modelName(agent, found.name) : shortModel(current)) : t('composer.modelDefault');

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    setError(null);
    if (o) {
      void useModels.getState().load(agent);
      // Every version, not only the agent's shortcuts.
      void useModels.getState().loadCatalog(agent);
    }
  };

  const choose = async (value: string | null) => {
    setOpen(false);
    setSwitching(true);
    try {
      useApp.getState().setSettings(await setAgentModel(agent, value, chatId));
      track('model picked', { agent, model: value ?? 'default' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setOpen(true);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tip label={t('composer.modelLabel', { name: label })}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            disabled={disabled}
            aria-label={t('composer.modelLabel', { name: label })}
            className={cn(ICON_BUTTON, 'w-auto max-w-44 px-2.5 text-[12px]')}
          >
            <span className="truncate">{label}</span>
            {loading || switching ? (
              <BumaLoading variant="data" label={false} size={16} labelText={t('composer.loadingModels', { agent: AGENT_NAMES[agent] })} className="shrink-0" />
            ) : (
              <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            )}
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent side="top" align="start" className="w-80 border-hairline bg-card p-0">
        <Command>
          <CommandInput placeholder={t('composer.findModel')} />
          <CommandList className="max-h-72">
            {loading && !options.length ? (
              <div className="flex flex-col gap-1 px-1 py-1">
                <BumaLoading variant="data" labelText={t('composer.loadingModels', { agent: AGENT_NAMES[agent] })} className="px-2 py-2 text-xs text-text-3" />
                {[72, 56, 64, 48].map((w) => (
                  <span key={w} aria-hidden="true" className="flex h-9 items-center px-2">
                    <span className="h-3 animate-pulse rounded bg-raised motion-reduce:animate-none" style={{ width: `${w}%` }} />
                  </span>
                ))}
              </div>
            ) : (
              <>
                {loading && (
                  <BumaLoading variant="data" labelText={t('composer.refreshingModels')} className="px-3 pt-2 pb-1 text-[11px] text-text-3" />
                )}
                <CommandEmpty>{t('composer.noModelMatch')}</CommandEmpty>
                {!options.length && <p className="m-0 px-3 pt-3 pb-1 text-xs text-text-3">{t('composer.noModels')}</p>}
                <CommandItem value="__default" onSelect={() => void choose(null)} className="h-9 gap-2 text-[13px]">
                  <span>{t('composer.modelDefault')}</span>
                  {!picked && <Check size={14} strokeWidth={1.5} aria-hidden="true" className="ml-auto" />}
                </CommandItem>
                {groups.map((g) => (
                  <CommandGroup key={g.family ?? '-'} heading={g.family ?? t('settings.route.shortcuts')}>
                    {g.items.map((o) => (
                      <CommandItem
                        key={o.value}
                        value={`${o.name} ${o.value}`}
                        title={o.description ?? o.value}
                        onSelect={() => void choose(o.value)}
                        className="min-h-9 gap-2 text-[13px]"
                      >
                        <span className="min-w-0 flex-1 truncate">{modelName(agent, o.name)}</span>
                        {o.name !== o.value && <span aria-hidden="true" className="max-w-[40%] truncate font-mono text-[10px] text-text-3">{o.value}</span>}
                        {o.value === current && <Check size={14} strokeWidth={1.5} aria-hidden="true" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </>
            )}
          </CommandList>
        </Command>
        {(error || failed) && (
          <p role="alert" className="m-0 border-t border-hairline px-3 py-2 text-xs text-error">
            {error ?? t('composer.modelsFailed', { message: failed ?? '' })}
          </p>
        )}
        <p className="m-0 border-t border-hairline px-3 py-2 text-[11px] text-text-3">{t('composer.modelHint', { agent: AGENT_NAMES[agent] })}</p>
      </PopoverContent>
    </Popover>
  );
}

export function Composer({
  chatId,
  onSend,
  disabled,
  projects,
  mention = null,
  onMention,
  quickChips,
  sees,
  placeholder,
  mentionSignal = 0,
  onStop,
  agentId,
  onAgentChange,
  ensureChat,
  initialText,
  draftKey,
  autoFocus,
}: {
  chatId: string | null;
  /** Resolve to false when sending failed: the draft is then kept. */
  onSend(parts: MessagePart[]): void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  /** Features the @ menu can list. Omit to turn the menu off. */
  projects?: Project[];
  mention?: MentionRef | null;
  onMention?(m: MentionRef | null): void;
  quickChips?: boolean;
  /** Project chat only: the title shown in "This chat sees ...". */
  sees?: string;
  placeholder?: string;
  /** Bump to open the @ menu from outside. */
  mentionSignal?: number;
  /** While the agent is working (`disabled`), show a Stop button that calls this. */
  onStop?(): void;
  /** The agent this chat talks to; defaults to the one picked in Settings. */
  agentId?: AgentId;
  /** Turns the agent button into a picker. Disabled while a turn runs. */
  onAgentChange?(id: AgentId): void;
  /** A new chat has no id until its first send: attaching creates it. */
  ensureChat?(): Promise<string>;
  /** Starts the box with this text (not sent). */
  initialText?: string;
  /** Keeps the unsent text in the chat store under this key, so it is there when the screen comes back. */
  draftKey?: string;
  /** Takes the focus, and takes it back each time the box is enabled again (after a turn). */
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const defaultAgent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const agent = agentId ?? defaultAgent;
  const settingsAuto = useApp((s) => s.settings?.autoMode ?? false);
  const auto = useChat((s) => autoOn(s, chatId, settingsAuto));
  const mode = useChat((s) => modeOf(s, chatId, settingsAuto));
  const autoBusy = useChat((s) => !!chatId && !!s.autoBusy[chatId]);
  const attachments = useChat((s) => (chatId ? s.attachments[chatId] : undefined)) ?? NONE;
  const [text, setText] = useState(() => initialText ?? (draftKey ? useChat.getState().drafts[draftKey]?.text : undefined) ?? '');
  useEffect(() => {
    if (draftKey) useChat.getState().setDraft(draftKey, { text });
  }, [draftKey, text]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  // The field grows with what is typed up to MAX_FIELD px, then scrolls inside (set by hand: older
  // webviews don't have `field-sizing`).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD)}px`;
  }, [text]);
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  const attachPaths = async (paths: string[]) => {
    if (paths.length === 0) return;
    setAttachError(null);
    try {
      const id = chatId ?? (await ensureChat?.());
      if (!id) return;
      for (const path of paths) {
        try {
          useChat.getState().attach(id, await attachFile(id, path));
        } catch (e) {
          setAttachError(errorText(e));
        }
      }
    } catch (e) {
      setAttachError(errorText(e));
    }
  };
  // Dropped paths arrive from the window, so the latest closure goes through a ref.
  const attachRef = useRef(attachPaths);
  attachRef.current = attachPaths;

  const pickFiles = async () => {
    try {
      const picked = await openDialog({ multiple: true, directory: false });
      if (!picked) return;
      await attachPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (e) {
      setAttachError(errorText(e));
    }
  };

  // A folder attached to the chat: its agent works there, and the sidebar lists it as a group.
  // A project chat works in its project's folder, so only other chats take one.
  const allowFolder = !sees;
  const folder = useFolders((s) => (chatId ? s.byChat[chatId] : undefined));
  const attachFolder = async () => {
    setAttachError(null);
    try {
      const path = await pickFolder();
      if (!path) return;
      const id = chatId ?? (await ensureChat?.());
      if (!id) return;
      await useFolders.getState().attach(id, path, useChat.getState().rows[id]?.title ?? t('chat.newChat'));
    } catch (e) {
      setAttachError(errorText(e));
    }
  };

  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    const over = (pos: { x: number; y: number }) => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return false;
      const x = pos.x / window.devicePixelRatio;
      const y = pos.y / window.devicePixelRatio;
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    try {
      getCurrentWebview()
        .onDragDropEvent((e) => {
          const p = e.payload;
          if (p.type === 'leave') setDragging(false);
          else if (p.type === 'drop') {
            const hit = over(p.position);
            setDragging(false);
            if (hit && !disabledRef.current) void attachRef.current(p.paths);
          } else setDragging(over(p.position) && !disabledRef.current);
        })
        .then((fn) => (gone ? fn() : (off = fn)))
        .catch(() => {});
    } catch {
      /* not running inside Tauri */
    }
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    if (autoFocus && !disabled) ref.current?.focus();
  }, [autoFocus, disabled]);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (mentionSignal > 0) {
      setText((t) => (t && !/\s$/.test(t) ? `${t} @` : `${t}@`));
      setDismissed(null);
      ref.current?.focus();
    }
  }, [mentionSignal]);

  // `/` at the start: the skills menu (every built-in and added skill).
  const slash = SLASH.exec(text);
  const skills = useSlashSkills(!!slash);
  const slashItems = slash ? filterSkills(skills, slash[1] ?? '') : [];
  const slashOpen = !!slash && dismissed !== text;
  const [slashActive, setSlashActive] = useState(0);
  const slashQuery = slash?.[1] ?? null;
  useEffect(() => setSlashActive(0), [slashQuery]);
  const pickSkill = (s: SlashSkill) => {
    setText(`/${s.id} `);
    setSlashActive(0);
    ref.current?.focus();
  };

  const token = projects ? TOKEN.exec(text) : null;
  const query = token?.[2] ?? '';
  const projectMatches = token && projects ? filterProjects(projects, query) : undefined;
  const items = (projectMatches ?? []).map(projectKey);
  const open = !!token && dismissed !== text;
  const current = items.includes(active) ? active : items[0];

  const pick = (p: Project) => {
    onMention?.({ projectId: p.id, title: p.title });
    setText((t) => t.replace(TOKEN, '$1'));
    ref.current?.focus();
  };

  const pickKey = (key: string) => {
    const p = projectMatches?.find((x) => projectKey(x) === key);
    if (p) pick(p);
  };

  // While the agent works (`disabled` with a Stop), the box stays open: what is sent waits in the queue.
  const working = !!disabled && !!onStop;
  const locked = !!disabled && !working;
  const queued = useChat((s) => (chatId ? s.queued[chatId] : undefined)) ?? NO_QUEUE;
  const canSend = !locked && (text.trim().length > 0 || !!mention || attachments.length > 0);
  const sending = useRef(false);
  const send = async () => {
    if (!canSend || sending.current) return;
    const parts: MessagePart[] = [];
    if (text.trim()) parts.push({ type: 'text', text: text.trim() });
    if (mention) parts.push({ type: 'mention', ...mention });
    sending.current = true;
    const draft = text;
    setText('');
    const giveBack = () => setText((t) => t || draft);
    try {
      // The prompt may run for the whole turn, so clear now and give the draft back on failure.
      if ((await onSend(parts)) === false) giveBack();
    } catch {
      giveBack();
    } finally {
      sending.current = false;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (slashOpen) {
      const n = slashItems.length;
      if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        setSlashActive((i) => (Math.min(i, n - 1) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
        return;
      }
      if (n && (e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        pickSkill(slashItems[Math.min(slashActive, n - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(text);
        return;
      }
    }
    if (open && items.length > 0) {
      const i = Math.max(0, items.indexOf(current ?? ''));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = items.length;
        setActive(items[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]!);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (current) pickKey(current);
        return;
      }
    }
    if (open && e.key === 'Escape') {
      e.preventDefault();
      setDismissed(text);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (open) setDismissed(text);
      else void send();
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-col gap-3">
      {quickChips && (
        <div className="flex flex-wrap gap-2">
          {QUICK_CHIPS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={locked}
              onClick={() => void onSend([{ type: 'text', text: t(`composer.chips.${q}`) }])}
              className="h-8 cursor-pointer rounded-full border border-hairline bg-transparent px-3 text-[13px] text-text-2 transition-colors hover:bg-raised hover:text-foreground disabled:cursor-default disabled:opacity-50"
            >
              {t(`composer.chips.${q}`)}
            </button>
          ))}
        </div>
      )}
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div
            ref={box}
            data-no-drag
            className={`relative flex flex-col gap-3 rounded-lg border bg-card p-3 transition-colors ${dragging ? 'border-primary' : 'border-hairline focus-within:border-text-3'}`}
          >
            {attachError && (
              <p role="alert" className="m-0 text-xs text-error">
                {attachError}
              </p>
            )}
            {(mention || attachments.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {mention && (
                  <span className="inline-flex h-6 items-center gap-1 rounded-sm border border-primary-border bg-primary-soft pl-2 pr-1 text-[13px] font-medium text-primary-text">
                    @{mention.title}
                    <button
                      type="button"
                      aria-label={t('composer.removeVideo')}
                      onClick={() => onMention?.(null)}
                      className="inline-flex size-4 cursor-pointer items-center justify-center border-none bg-transparent p-0 text-primary-text"
                    >
                      <X size={12} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </span>
                )}
                {attachments.map((a, i) =>
                  a.type === 'file' ? (
                    <FileChip key={i} part={a} onRemove={() => chatId && useChat.getState().detach(chatId, i)} />
                  ) : null,
                )}
              </div>
            )}
            {folder && chatId && (
              <div className="flex flex-wrap gap-1.5">
                <span data-testid="folder-chip" title={folder} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-hairline bg-raised pr-1 pl-2 text-[12px]">
                  <Folder size={13} strokeWidth={1.5} aria-hidden="true" className="text-text-2" />
                  {folderTitle(folder)}
                  <button
                    type="button"
                    aria-label={t('composer.removeFolder', { name: folderTitle(folder) })}
                    onClick={() => void useFolders.getState().detach(chatId)}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-text-3 hover:bg-hairline hover:text-foreground"
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              </div>
            )}
            {slashOpen && (
              // Floats above the message box, like the @ menu.
              <div className="absolute bottom-full left-0 z-30 mb-2">
                <SlashMenu items={slashItems} active={Math.min(slashActive, Math.max(0, slashItems.length - 1))} onPick={pickSkill} onActive={setSlashActive} />
              </div>
            )}
            {queued.length > 0 && chatId && (
              <ul aria-label={t('composer.queuedTitle', { count: queued.length })} className="m-0 flex list-none flex-col gap-1 p-0">
                {queued.map((q) => (
                  <li key={q.id} className="flex items-center gap-2 rounded-md bg-raised px-2.5 py-1.5 text-[13px]">
                    <span className="shrink-0 text-[11px] font-medium text-text-3">{t('composer.queued')}</span>
                    <span className="min-w-0 flex-1 truncate">{q.parts.map((p) => (p.type === 'text' ? p.text : p.type === 'mention' ? `@${p.title}` : '')).join(' ')}</span>
                    <button
                      type="button"
                      aria-label={t('composer.unqueue')}
                      onClick={() => useChat.getState().unqueue(chatId, q.id)}
                      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-text-3 hover:bg-hairline hover:text-foreground"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label htmlFor="composer-message" className="sr-only">
              {t('composer.message')}
            </label>
            <div className="flex items-end gap-2">
                <DropdownMenu>
                  <Tip label={t('composer.add')}>
                    <DropdownMenuTrigger asChild disabled={locked}>
                      <button type="button" aria-label={t('composer.add')} className={ICON_BUTTON}>
                        <Plus size={22} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                  </Tip>
                  <DropdownMenuContent side="top" align="start" className="w-60">
                    <DropdownMenuItem onSelect={() => void pickFiles()}>
                      <Paperclip size={15} strokeWidth={1.5} aria-hidden="true" />
                      {t('composer.addFiles')}
                    </DropdownMenuItem>
                    {allowFolder && (
                      <DropdownMenuItem onSelect={() => void attachFolder()}>
                        <FolderPlus size={15} strokeWidth={1.5} aria-hidden="true" />
                        {t('composer.addFolder')}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      onSelect={() => {
                        setText('/');
                        setDismissed(null);
                        setTimeout(() => ref.current?.focus(), 0);
                      }}
                    >
                      <Slash size={15} strokeWidth={1.5} aria-hidden="true" />
                      {t('composer.addSkill')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            <Textarea
              id="composer-message"
              ref={ref}
              rows={1}
              value={text}
              disabled={locked}
              placeholder={placeholder ?? t('composer.placeholder')}
              onChange={(e) => {
                setText(e.target.value);
                setActive('');
              }}
              onKeyDown={onKeyDown}
              className="min-h-8 max-h-[200px] flex-1 resize-none overflow-y-auto [field-sizing:fixed] rounded-none border-0 bg-transparent px-0 py-[5px] text-[14px] leading-[1.6] shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
            />
                {/* One button: Stop while the agent works and the box is empty, otherwise Send (queued while it works). */}
                {working && !canSend ? (
                  <button
                    type="button"
                    aria-label={t('composer.stop')}
                    title={t('composer.stopHint')}
                    onClick={onStop}
                    className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-hairline bg-raised text-foreground transition-colors hover:bg-hairline"
                  >
                    <Square size={12} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={working ? t('composer.queue') : t('composer.send')}
                    title={working ? t('composer.queueHint') : undefined}
                    disabled={!canSend}
                    onClick={() => void send()}
                    className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-default disabled:opacity-50"
                  >
                    <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[min(400px,calc(100vw-2rem))] border-hairline bg-card p-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <MentionMenu projects={projectMatches ?? []} query={query} value={current ?? ''} onValueChange={setActive} onPick={pick} />
        </PopoverContent>
      </Popover>
        <div data-no-drag className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-2">
              {/* No model to pick here: the chat follows the agent route (Agents › Provider). */}
              <ComboPicker agent={agent} chatId={chatId} />
              {(onAgentChange || !chatId) && (
                <ModePicker
                  mode={mode}
                  agent={agent}
                  disabled={locked || autoBusy}
                  onChange={(m) => void useChat.getState().setMode(chatId, m)}
                />
              )}
              {projects && (
                <Tip label={t('composer.mention')}>
                  <button
                    type="button"
                    aria-label={t('composer.mention')}
                    disabled={disabled}
                    onClick={() => {
                      setText((t) => (t && !/\s$/.test(t) ? `${t} @` : `${t}@`));
                      setDismissed(null);
                      ref.current?.focus();
                    }}
                    className={ICON_BUTTON}
                  >
                    <AtSign size={16} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </Tip>
              )}
              {sees && <span className="truncate text-xs text-text-3">{t('composer.sees', { title: sees })}</span>}
        </div>
    </div>
    </TooltipProvider>
  );
}
