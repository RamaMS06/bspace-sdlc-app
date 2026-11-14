import { useTranslation } from 'react-i18next';
import { Check, Cloud, FileText } from 'lucide-react';
import { siFigma, siFlutter, siGit, siPython, type SimpleIcon } from 'simple-icons';
import type { SystemInfo, ToolId, ToolStatus } from '@bspace-sdlc-app/shared';
import { openUrl } from '@tauri-apps/plugin-opener';
import { installCommands, manualInstallUrl } from '@bspace-sdlc-app/skills';
import { StatusIcon } from '@/shared/ui/StatusIcon';
import { AgentLogo } from '@/shared/ui/AgentLogo';
import { Button } from '@/shared/ui/Button';
import { PermissionCard } from '@/shared/ui/PermissionCard';
import { toolDetail, toolName } from '@/features/tools/lib/tools';
import { cn } from '@/shared/lib/utils';
import { useApp } from '@/shared/state/app';
import { useInstall, type LogLine, type ToolInstall } from '@/features/tools/state/install';

export const TOOL_ORDER: ToolId[] = ['node', 'git', 'python', 'figma-mcp', 'azure-cli', 'figma', 'flutter', 'word'];

/** Brand marks from simple-icons (CC0), in their own colors. Word has none there (Microsoft's marks were removed). */
const MARKS: Partial<Record<ToolId, SimpleIcon>> = { git: siGit, python: siPython, 'figma-mcp': siFigma, figma: siFigma, flutter: siFlutter };

function ToolIcon({ id }: { id: ToolId }) {
  const mark = MARKS[id];
  if (id === 'node') return <AgentLogo id="node" size={22} />;
  if (id === 'azure-cli') return <Cloud size={20} strokeWidth={1.5} aria-hidden="true" className="text-info" />;
  if (!mark) return <FileText size={20} strokeWidth={1.5} aria-hidden="true" />;
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} fill={`#${mark.hex}`} aria-hidden="true">
      <path d={mark.path} />
    </svg>
  );
}

function LogList({ log, done }: { log: LogLine[]; done: boolean }) {
  if (log.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 rounded-md border border-border bg-sidebar p-3">
      {log.map((l) => {
        const state = done || l.status === 'done' ? 'done' : l.status === 'failed' ? 'failed' : 'active';
        return (
          <li key={l.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                state === 'done' && 'bg-text-3',
                state === 'active' && 'bg-primary',
                state === 'failed' && 'border border-hairline',
              )}
            />
            <span className={cn(state === 'active' ? 'text-foreground' : 'font-mono text-text-2')}>{l.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ToolRow({ tool, sys, agentName, busy, onInstall }: {
  tool: ToolStatus;
  sys: SystemInfo | null;
  agentName: string;
  busy: boolean;
  onInstall(): void;
}) {
  const inst: ToolInstall | undefined = useInstall((s) => s.tools[tool.id]);
  const request = useInstall((s) => s.request);
  const respond = useInstall((s) => s.respond);
  const cancel = useInstall((s) => s.cancel);
  const dismiss = useInstall((s) => s.dismiss);
  const active = useInstall((s) => s.active);
  const agent = useApp((s) => s.settings?.defaultAgent) ?? 'claude';
  const { t } = useTranslation();
  const detailText = toolDetail(tool);
  const name = toolName(tool);
  const askText = t(`tools.${tool.id}.ask`);

  // Node, and Chrome on a Mac without Homebrew: the user installs it from the download page.
  const manualUrl = manualInstallUrl(tool.id, sys);
  const status = inst?.status ?? 'missing';
  // Installed, but older than Buma needs: say so, or "Install" reads as if nothing was found.
  const tooOld = tool.id === 'node' && tool.found && !tool.ok && !!tool.version;
  const ok = tool.ok || status === 'done';
  const showMissing = !ok && (status === 'missing' || status === 'failed');
  const detail = ok
    ? status === 'done'
      ? t('tools.installedBy', { agent: agentName })
      : detailText
    : (tooOld && t('tools.node.tooOld', { version: tool.version ?? '' })) || t(`tools.${tool.id}.missing`, { defaultValue: detailText });
  const label = tooOld ? t('tools.update') : t('tools.install');
  const expected = sys ? installCommands(tool.id, sys, agent) : [];

  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-raised text-text-2">
          <ToolIcon id={tool.id} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-medium">{name}</span>
          <span className="text-[13px] text-text-3">{detail}</span>
        </div>
        {ok && (
          <span className="inline-flex items-center gap-2 text-sm text-foreground tabular-nums">
            <Check size={16} strokeWidth={1.5} aria-hidden="true" className="text-foreground" />
            {tool.version ?? t('tools.found')}
          </span>
        )}
        {showMissing && (
          <Button
            variant={tool.required ? 'primary' : 'secondary'}
            className="h-9 px-3 text-[13px]"
            disabled={busy}
            aria-label={status === 'failed' ? undefined : `${label} ${name}`}
            onClick={() =>
              manualUrl ? void openUrl(manualUrl).catch(() => {}) : onInstall()
            }
          >
            {status === 'failed' ? t('common.tryAgain') : label}
          </Button>
        )}
        {(status === 'running' || status === 'confirm') && !ok && (
          <span className="inline-flex items-center gap-2 text-[13px] text-text-2">
            <StatusIcon kind="working" size={20} />
            {status === 'running' ? t('tools.installing') : t('tools.waiting')}
          </span>
        )}
        {status === 'running' && !ok && (
          <Button variant="ghost" className="h-9 px-2 text-[13px]" onClick={() => void cancel(tool.id)}>
            {t('common.cancel')}
          </Button>
        )}
      </div>

      {status === 'failed' && inst?.error && (
        <p role="alert" className="m-0 text-[13px] text-error">{inst.error}</p>
      )}

      {status === 'failed' && inst?.reply?.trim() && (
        <details className="text-[13px] text-text-3">
          <summary className="cursor-pointer select-none hover:text-text-2">{t('tools.agentSaid', { agent: agentName })}</summary>
          <p className="m-0 mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-sidebar p-3 text-text-2">
            {inst.reply.trim()}
          </p>
        </details>
      )}

      {request && active === tool.id && (
        <PermissionCard request={request} ask={askText} agentId={agent} onRespond={(id) => void respond(id)} />
      )}

      {status === 'confirm' && !request && (
        <div className="flex flex-col gap-2 rounded-md border border-hairline bg-ink p-3">
          <span className="text-xs text-text-3">{t('tools.willAsk', { agent: agentName })}</span>
          <pre className="m-0 rounded-sm border border-border bg-sidebar px-3 py-2 font-mono text-xs leading-[1.7] whitespace-pre-line text-foreground">
            {expected.join('\n')}
          </pre>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-3">{t('tools.nothingRuns')}</span>
            <Button variant="ghost" className="ml-auto h-9 px-2 text-[13px]" onClick={() => void cancel(tool.id)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {(status === 'running' || (status === 'done' && !!inst?.log.length)) && (
        <LogList log={inst?.log ?? []} done={status === 'done'} />
      )}
    </li>
  );
}
