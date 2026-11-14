import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelRight } from 'lucide-react';
import type { AgentId, Chat, MessagePart, Project } from '@bspace-sdlc-app/shared';
import { TraceButton } from '@/features/chat/components/TraceDialog';
import { Composer } from '@/features/chat/components/Composer';
import { MessageList } from '@/features/chat/components/MessageList';
import { PermissionCard } from '@/shared/ui/PermissionCard';
import { QuestionCard } from '@/features/chat/components/QuestionCard';
import { ResizeHandle } from '@/shared/ui/ResizeHandle';
import { FileTree } from '@/features/chat/components/workspace/FileTree';
import { Workspace } from '@/features/chat/components/workspace/Workspace';
import { ScrollToBottom } from '@/features/chat/components/ScrollToBottom';
import { TurnRail } from '@/features/chat/components/TurnRail';
import { StepBar, FeaturePipeline, STEP_OF_STAGE, useFeatureState } from '@/features/sdlc';
import { getChat, listProjects } from '@/shared/lib/ipc';
import { projectSendOptions } from '@/features/chat/lib/openProject';
import { useApp } from '@/shared/state/app';
import { headPermission, headQuestion, useChat, type SendOpts } from '@/features/chat/state/chat';
import { useUsage } from '@/features/usage';
import { FILES, PREVIEW, useFittedLayout, useLayout } from '@/shared/state/layout';
import { useProjectTabs, useWorkspace } from '@/features/chat/state/workspace';
import { cn } from '@/shared/lib/utils';

const NO_MESSAGES: never[] = [];
/** How often the file sidebar reads its folders again while the agent works. */
const TREE_REFRESH_MS = 4000;

export function ChatProject({ chatId, draft }: { chatId: string; draft?: string }) {
  const { t } = useTranslation();
  const defaultAgent = useApp((s) => s.settings?.defaultAgent ?? 'claude');
  const [chat, setChat] = useState<Chat | null>(null);
  const agent = chat?.agentId ?? defaultAgent;
  const [project, setProject] = useState<Project | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const messages = useChat((s) => s.messages[chatId]) ?? NO_MESSAGES;
  const streaming = useChat((s) => !!s.streaming[chatId]);
  const permission = useChat((s) => headPermission(s, chatId));
  const question = useChat((s) => headQuestion(s, chatId));
  const fitted = useFittedLayout(true);
  const projectsVersion = useApp((s) => s.projectsVersion);
  // Where the feature really is comes from the files in its folder, not from its saved status.
  const featureState = useFeatureState(project?.id);
  const stepOf = (st: typeof featureState) => (st ? STEP_OF_STAGE[Math.min(st.current, STEP_OF_STAGE.length - 1)] : 0);
  const seenVersion = useRef(projectsVersion);
  const filesOpen = useLayout((s) => s.filesOpen);
  const tabs = useProjectTabs(project?.id ?? '');

  useEffect(() => {
    useChat.getState().listen();
    void useChat.getState().load(chatId);
    let alive = true;
    Promise.all([getChat(chatId), listProjects()])
      .then(([found, projects]: [Chat | null, Project[]]) => {
        if (!alive) return;
        setChat(found);
        setProject(projects.find((p) => p.id === found?.projectId) ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chatId]);

  // The project moved on (its status): the header follows.
  useEffect(() => {
    if (!project || projectsVersion === seenVersion.current) return;
    seenVersion.current = projectsVersion;
    let alive = true;
    listProjects()
      .then((all) => {
        const found = all.find((p) => p.id === project.id);
        if (alive && found) setProject(found);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectsVersion, project?.id]);

  useEffect(() => {
    useUsage.getState().setChatAgent(agent);
    return () => useUsage.getState().setChatAgent(null);
  }, [agent]);

  const switchAgent = async (next: AgentId) => {
    if (next === agent || streaming) return;
    try {
      await useChat.getState().switchAgent(chatId, next);
      setChat((c) => (c ? { ...c, agentId: next } : c));
    } catch {
      /* the chat keeps its agent */
    }
  };

  // When a turn ends well the agent may have written new files: reload the workspace.
  const wasStreaming = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wasStreaming.current && !streaming && messages.at(-1)?.role !== 'system') setReloadKey((k) => k + 1);
    wasStreaming.current = streaming;
  }, [streaming, messages]);

  // While the agent works the file sidebar follows its edits: read the open folders again every few seconds.
  const [treeKey, setTreeKey] = useState(0);
  useEffect(() => {
    if (!streaming || !filesOpen) return;
    const timer = setInterval(() => setTreeKey((k) => k + 1), TREE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [streaming, filesOpen]);

  /** What every send from this screen carries: the composer's and an answered A2UI surface's alike. */
  const sendOptions = (): SendOpts => projectSendOptions(project, agent);

  const send = (parts: MessagePart[]) => {
    void useChat.getState().send(chatId, parts, sendOptions());
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header data-tauri-drag-region className="flex h-16 shrink-0 items-center gap-6 border-b border-border px-6">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-medium">{project?.title ?? t('chat.title')}</span>
          {project && <span className="text-xs text-text-3">{t('pipeline.feature')}</span>}
        </div>
        {project && (
          <div className="@container/steps ml-auto flex min-w-0 flex-1 justify-end overflow-hidden">
            <StepBar status={project.status} step={stepOf(featureState)} />
          </div>
        )}
        {!project && <span className="ml-auto" />}
        <TraceButton chatId={chatId} />
        {project && (
          <button
            type="button"
            aria-pressed={filesOpen}
            aria-controls="chat-files"
            aria-label={filesOpen ? t('workspace.hideFiles') : t('workspace.showFiles')}
            title={filesOpen ? t('workspace.hideFiles') : t('workspace.showFiles')}
            onClick={() => useLayout.getState().toggleFiles()}
            className={cn(
              '-mr-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-raised',
              filesOpen ? 'text-foreground' : 'text-text-3',
            )}
          >
            <PanelRight size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <section aria-label={t('chat.conversation')} className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="no-scrollbar h-full overflow-y-auto overflow-x-hidden px-6 py-6">
            <MessageList messages={messages} streaming={streaming} sendOptions={sendOptions} scrollRef={scrollRef}>
              {question && (
                <QuestionCard
                  question={question}
                  agentId={agent}
                  onRespond={(r, summary) => void useChat.getState().respondQuestion(chatId, r, summary)}
                />
              )}
              {permission && (
                <PermissionCard
                  request={permission}
                  agentId={agent}
                  allowLabel={t('permission.allow')}
                  onRespond={(o) => void useChat.getState().respondPermission(chatId, o)}
                />
              )}
            </MessageList>
          </div>
          <TurnRail messages={messages} scrollRef={scrollRef} />
          <ScrollToBottom scrollRef={scrollRef} />
          </div>
          <div className="px-6 pb-6 pt-2">
            <Composer
              chatId={chatId}
              initialText={draft}
              onSend={send}
              disabled={streaming}
              onStop={() => void useChat.getState().cancel(chatId)}
              agentId={agent}
              onAgentChange={(a) => void switchAgent(a)}
              quickChips
              sees={project?.title}
            />
          </div>
        </section>
        <section
          id="chat-preview"
          aria-label={t('chat.preview')}
          // A narrow window has no room for the preview: it hides (like Claude Desktop's side panels).
          hidden={fitted.narrow}
          className="relative shrink-0 border-l border-border"
          style={{ width: fitted.preview }}
        >
          <ResizeHandle
            label={t('layout.resizePreview')}
            side="left"
            aria-controls="chat-preview"
            value={fitted.preview}
            min={PREVIEW.min}
            max={fitted.previewMax}
            onResize={(w, live) => useLayout.getState().setPreview(Math.min(w, fitted.previewMax), live)}
            onReset={() => useLayout.getState().resetPreview()}
          />
          {project ? (
            <Workspace
              projectId={project.id}
              reloadKey={reloadKey}
              preview={<FeaturePipeline project={project} />}
            />
          ) : (
            <div data-testid="preview-slot" />
          )}
        </section>
        {project && fitted.files > 0 && (
          <aside id="chat-files" aria-label={t('workspace.files')} className="relative shrink-0 border-l border-border" style={{ width: fitted.files }}>
            <ResizeHandle
              label={t('layout.resizeFiles')}
              side="left"
              aria-controls="chat-files"
              value={fitted.files}
              min={FILES.min}
              max={fitted.filesMax}
              onResize={(w, live) => useLayout.getState().setFiles(Math.min(w, fitted.filesMax), live)}
              onReset={() => useLayout.getState().resetFiles()}
            />
            <FileTree
              projectId={project.id}
              folderName={project.folder.split(/[\\/]/).filter(Boolean).pop() ?? project.title}
              activePath={tabs.active}
              reloadKey={reloadKey + treeKey}
              onOpen={(path) => useWorkspace.getState().open(project.id, path)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
