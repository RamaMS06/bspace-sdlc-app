import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentId, MessagePart, Project } from '@bspace-sdlc-app/shared';
import { Composer, type MentionRef } from '@/components/Composer';
import { MessageList } from '@/components/MessageList';
import { PermissionCard } from '@/components/PermissionCard';
import { QuestionCard } from '@/components/QuestionCard';
import { ScrollToBottom } from '@/components/ScrollToBottom';
import { TraceButton } from '@/components/TraceDialog';
import { TurnRail } from '@/components/TurnRail';
import { createFeature, sdlcStart } from '@/lib/featureFlow';
import { listProjects, setChatProject } from '@/lib/ipc';
import { mentionContext, mentionedIn } from '@/lib/mentions';
import { useApp } from '@/state/app';
import { headPermission, headQuestion, useChat } from '@/state/chat';
import { useUsage } from '@/state/usage';

const NO_MESSAGES: never[] = [];

/**
 * A chat without a project: what New chat becomes after its first send, and what Recent opens. The
 * conversation and the composer, without the project's header and preview.
 */
export function ChatThread({ chatId, draft }: { chatId: string; draft?: string }) {
  const { t } = useTranslation();
  const settings = useApp((s) => s.settings);
  const row = useChat((s) => s.rows[chatId]);
  const messages = useChat((s) => s.messages[chatId]) ?? NO_MESSAGES;
  const streaming = useChat((s) => !!s.streaming[chatId]);
  const permission = useChat((s) => headPermission(s, chatId));
  const question = useChat((s) => headQuestion(s, chatId));
  const agent = row?.agentId ?? settings?.defaultAgent ?? 'claude';
  const [projects, setProjects] = useState<Project[]>([]);
  const [mention, setMention] = useState<MentionRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Straight from New chat: the composer the user was typing in keeps the focus.
  const [focus] = useState(() => useApp.getState().focusChatId === chatId);
  useEffect(() => {
    if (focus) useApp.setState({ focusChatId: null });
  }, [focus]);
  const seen = useMemo(() => mentionedIn(messages), [messages]);

  useEffect(() => {
    useChat.getState().listen();
    void useChat.getState().load(chatId);
    let alive = true;
    listProjects()
      .then((p) => alive && setProjects(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chatId]);

  useEffect(() => {
    useUsage.getState().setChatAgent(agent);
    return () => useUsage.getState().setChatAgent(null);
  }, [agent]);

  const switchAgent = async (next: AgentId) => {
    if (next === agent || streaming) return;
    try {
      await useChat.getState().switchAgent(chatId, next);
      if (row) useChat.getState().rememberChat({ ...row, agentId: next });
    } catch {
      /* the chat keeps its agent */
    }
  };

  const onSend = async (parts: MessagePart[]): Promise<boolean> => {
    setError(null);
    const sentMention = mention;
    setMention(null);
    const ctx = mentionContext(parts, seen, projects);
    // An SDLC skill typed here starts a feature: this chat moves into it and Workflow follows it.
    let job: { projectId: string; title: string } | undefined;
    const typed = parts.find((p) => p.type === 'text');
    const name = typed?.type === 'text' ? sdlcStart(typed.text) : null;
    if (settings && name !== null) {
      try {
        const feature = await createFeature(name || t('chat.newFeature'));
        const moved = await setChatProject(chatId, feature.id);
        useChat.getState().rememberChat(moved);
        job = { projectId: feature.id, title: feature.title };
      } catch {
        /* the chat goes on without a feature */
      }
    }
    const failure = await useChat
      .getState()
      .send(chatId, parts, { agentId: agent, ...(job ? { job } : {}), ...(ctx.length ? { promptParts: [...ctx, ...parts] } : {}) });
    // The chat already shows why in a system line.
    if (failure) setMention(sentMention);
    return !failure;
  };

  const attached = new Set([...seen, ...(mention ? [mention.projectId] : [])]).size;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header data-tauri-drag-region className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="truncate text-[15px] font-medium">{row?.title || t('chat.title')}</span>
        <span className="shrink-0 text-xs text-text-3">
          {attached === 0 ? t('chat.noVideo') : t('chat.videosAttached', { count: attached })}
        </span>
        <TraceButton chatId={chatId} className="ml-auto" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center px-6">
        <div className="relative flex min-h-0 w-full flex-1 justify-center">
          <div ref={scrollRef} className="no-scrollbar flex min-h-0 w-full max-w-[720px] flex-1 flex-col gap-6 overflow-y-auto overflow-x-hidden py-6">
            <div className="my-auto">
              <MessageList
                messages={messages}
                streaming={streaming}
                scrollRef={scrollRef}
                sendOptions={() => ({ agentId: agent })}
              >
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
          </div>
          <TurnRail messages={messages} scrollRef={scrollRef} className="-right-6" />
          <ScrollToBottom scrollRef={scrollRef} />
        </div>

        <div className="w-full max-w-[720px] pb-6 pt-4">
          <Composer
            chatId={chatId}
            draftKey={chatId}
            autoFocus={focus}
            initialText={draft}
            onSend={onSend}
            disabled={streaming}
            onStop={() => void useChat.getState().cancel(chatId)}
            projects={projects}
            mention={mention}
            onMention={setMention}
            agentId={agent}
            onAgentChange={(a) => void switchAgent(a)}
          />
          {error && (
            <p role="alert" className="m-0 mt-2 text-xs text-error">
              {error}
            </p>
          )}
          <p className="m-0 mt-2 text-xs text-text-3">{t('chat.newChatNote')}</p>
        </div>
      </div>
    </div>
  );
}
