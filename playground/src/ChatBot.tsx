import {
  Avatar,
  Button,
  IconButton,
  TextArea,
  TextLink,
  Typography,
  AiPresence,
} from '@neo4j-ndl/react';
import {
  ArrowPathIconOutline,
  Cog6ToothIconOutline,
  HandThumbDownIconOutline,
  PaperAirplaneIconOutline,
  PlusIconOutline,
  Square2StackIconOutline,
  StopCircleIconOutline,
  XMarkIconOutline,
} from '@neo4j-ndl/react/icons';
import { useEffect, useRef, useState } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  thinkingTime?: number;
  isDone?: boolean;
};

// ─── Custom AI sub-components built from NDL primitives ───────────────────────

/** Renders a user chat bubble with avatar */
function UserBubble({ children }: { children: string }) {
  return (
    <div className="n-flex n-flex-row n-gap-2 n-items-start n-justify-end">
      <div className="n-max-w-[85%] n-bg-primary-bg-strong n-text-neutral-text-inverse n-rounded-xl n-px-4 n-py-2.5 n-text-sm">
        {children}
      </div>
      <Avatar
        name="NM"
        type="letters"
        size="small"
      />
    </div>
  );
}

/** Renders an assistant response with basic markdown-ish display */
function AssistantResponse({ children }: { children: string }) {
  return (
    <div className="n-w-full n-text-sm n-text-neutral-text-default n-whitespace-pre-wrap n-break-words n-leading-relaxed">
      {children || <span className="n-animate-pulse">▍</span>}
    </div>
  );
}

/** Thinking / streaming indicator */
function ThinkingIndicator({ isThinking, thinkingMs }: { isThinking: boolean; thinkingMs?: number }) {
  return (
    <div className="n-flex n-flex-row n-items-center n-gap-2 n-text-sm n-text-neutral-text-weaker">
      <AiPresence isThinking={isThinking} />
      {!isThinking && thinkingMs !== undefined && (
        <span>Thought for {(thinkingMs / 1000).toFixed(1)}s</span>
      )}
    </div>
  );
}

/** Suggestion button */
function SuggestionButton({
  children,
  isPrimary = false,
  onClick,
}: {
  children: string;
  isPrimary?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      fill={isPrimary ? 'filled' : 'outlined'}
      color="primary"
      size="medium"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// ─── Main ChatBot component ────────────────────────────────────────────────────

export default function ChatBot() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsThinking(false);
    setIsStreaming(false);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant') last.isDone = true;
      return updated;
    });
  };

  const handleSend = async (overridePrompt?: string) => {
    const text = overridePrompt ?? prompt;
    if (!text.trim()) return;

    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setPrompt('');
    setIsThinking(true);

    const startTime = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });

      const thinkingTime = Date.now() - startTime;
      setIsThinking(false);
      setIsStreaming(true);

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', isDone: false, thinkingTime },
      ]);

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') last.content = accumulated;
                  return updated;
                });
              }
            } catch {
              if (data) {
                accumulated += data;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last?.role === 'assistant') last.content = accumulated;
                  return updated;
                });
              }
            }
          }
        }
      }

      setIsStreaming(false);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') last.isDone = true;
        return updated;
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return;
      setIsThinking(false);
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '⚠️ Error connecting to the AI server. Please try again.',
          isDone: true,
          thinkingTime: Date.now() - startTime,
        },
      ]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const isRunning = isThinking || isStreaming;

  return (
    <section className="n-h-screen">
      <div className="n-w-[440px] n-h-full n-flex n-flex-col n-bg-neutral-bg-weak">

        {/* ── Header ── */}
        <div className="n-flex n-flex-row n-items-center n-border-b n-border-neutral-border-weak n-p-3">
          <Typography variant="h5" className="n-mr-auto n-pl-1">
            Neo4j AI Assistant
          </Typography>
          <IconButton isClean ariaLabel="Settings">
            <Cog6ToothIconOutline />
          </IconButton>
          <IconButton isClean ariaLabel="Close">
            <XMarkIconOutline />
          </IconButton>
        </div>

        {/* ── Messages area ── */}
        <div className="n-p-4 n-flex n-flex-col n-grow n-overflow-y-auto">
          {messages.length === 0 ? (

            /* Empty state */
            <div className="n-flex n-flex-col n-gap-8">
              <Typography variant="h1">
                Hi there, how can I help you today?
              </Typography>

              <div className="n-flex n-flex-col n-gap-3">
                <Typography variant="subheading-medium">Suggestions</Typography>
                <SuggestionButton isPrimary onClick={() => handleSend('I want to import data')}>
                  I want to import data
                </SuggestionButton>
                <SuggestionButton onClick={() => handleSend('Create an AI agent')}>
                  Create an AI agent
                </SuggestionButton>
                <SuggestionButton onClick={() => handleSend('Invite project members')}>
                  Invite project members
                </SuggestionButton>
                <SuggestionButton onClick={() => handleSend('Generate a report')}>
                  Generate a report
                </SuggestionButton>
              </div>

              <Typography variant="body-medium">
                You can also drag and drop files here, or{' '}
                <TextLink as="button" type="internal-underline">
                  browse
                </TextLink>
                . Supports CSV, MOV, PDF
              </Typography>
            </div>

          ) : (

            /* Chat messages */
            <div className="n-flex n-flex-col n-gap-4 n-pb-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`n-flex ${msg.role === 'user' ? 'n-justify-end' : 'n-justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    <UserBubble>{msg.content}</UserBubble>
                  ) : (
                    <div className="n-w-full n-flex n-flex-col n-gap-2">
                      {msg.thinkingTime !== undefined && (
                        <ThinkingIndicator isThinking={false} thinkingMs={msg.thinkingTime} />
                      )}
                      <AssistantResponse>{msg.content}</AssistantResponse>
                      {msg.isDone && (
                        <div className="n-flex n-flex-row n-gap-1.5">
                          <IconButton isClean size="small" ariaLabel="Dislike">
                            <HandThumbDownIconOutline />
                          </IconButton>
                          <IconButton
                            isClean
                            size="small"
                            ariaLabel="Re-run"
                            onClick={() => handleSend(messages[idx - 1]?.content)}
                          >
                            <ArrowPathIconOutline />
                          </IconButton>
                          <IconButton
                            isClean
                            size="small"
                            ariaLabel="Copy"
                            onClick={() => handleCopy(msg.content)}
                          >
                            <Square2StackIconOutline />
                          </IconButton>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isThinking && <ThinkingIndicator isThinking={true} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Prompt input ── */}
        <div className="n-px-4 n-pt-2 n-pb-3 n-mt-auto n-border-t n-border-neutral-border-weak">
          <div className="n-flex n-flex-col n-gap-2 n-bg-neutral-bg-default n-rounded-xl n-p-2 n-shadow-sm">
            <TextArea
              isFluid
              ariaLabel="Type your message"
              htmlAttributes={{
                value: prompt,
                onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value),
                onKeyDown: handleKeyDown,
                placeholder: 'Ask anything about Neo4j...',
                rows: 2,
                disabled: isRunning,
              }}
            />
            <div className="n-flex n-flex-row n-items-center n-justify-between">
              <IconButton isClean size="small" ariaLabel="Add files">
                <PlusIconOutline />
              </IconButton>
              {isRunning ? (
                <IconButton
                  size="small"
                  ariaLabel="Cancel"
                  isDanger
                  onClick={handleCancel}
                >
                  <StopCircleIconOutline />
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  ariaLabel="Send message"
                  isDisabled={prompt.trim().length === 0}
                  onClick={() => handleSend()}
                >
                  <PaperAirplaneIconOutline />
                </IconButton>
              )}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}