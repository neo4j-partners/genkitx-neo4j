import { CleanIconButton, TextLink, Typography } from "@neo4j-ndl/react";
import {
  Prompt,
  Response,
  Suggestion,
  Thinking,
  UserBubble,
} from "@neo4j-ndl/react/ai";
import {
  ArrowPathIconOutline,
  Cog6ToothIconOutline,
  HandThumbDownIconOutline,
  PlusIconOutline,
  Square2StackIconOutline,
  XMarkIconOutline,
} from "@neo4j-ndl/react/icons";
import { useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  thinkingTime?: number;
  isDone?: boolean;
};

export const Component = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsThinking(false);
    setIsStreaming(false);
    setMessages((prev) => {
      const newMessages = [...prev];
      const lastMessage = newMessages[newMessages.length - 1];
      if (lastMessage?.role === "assistant") {
        lastMessage.isDone = true;
      }
      return newMessages;
    });
  };

  const handleSend = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || prompt;
    if (!textToSend.trim()) return;

    setMessages((prev) => [...prev, { content: textToSend, role: "user" }]);
    setPrompt("");
    setIsThinking(true);

    const startTime = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: textToSend }),
        signal: controller.signal,
      });

      const thinkingTime = Date.now() - startTime;
      setIsThinking(false);
      setIsStreaming(true);

      setMessages((prev) => [
        ...prev,
        { content: "", isDone: false, role: "assistant", thinkingTime },
      ]);

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulated += parsed.text;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage.role === "assistant") {
                    lastMessage.content = accumulated;
                  }
                  return newMessages;
                });
              }
            } catch {
              if (data) {
                accumulated += data;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage.role === "assistant") {
                    lastMessage.content = accumulated;
                  }
                  return newMessages;
                });
              }
            }
          }
        }
      }

      setIsStreaming(false);
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage.role === "assistant") {
          lastMessage.isDone = true;
        }
        return newMessages;
      });
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setIsThinking(false);
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "⚠️ Error connecting to the AI server. Please try again.",
          isDone: true,
          thinkingTime: Date.now() - startTime,
        },
      ]);
    }
  };

  return (
    <section className="n-h-screen">
      <div className="n-w-[440px] n-h-full n-flex n-flex-col n-bg-neutral-bg-weak">
        <div className="n-flex n-flex-row n-border-b n-border-neutral-border-weak n-p-3">
          <div className="n-ml-auto">
            <CleanIconButton description="settings" tooltipProps={{}}>
              <Cog6ToothIconOutline />
            </CleanIconButton>
            <CleanIconButton description="close">
              <XMarkIconOutline />
            </CleanIconButton>
          </div>
        </div>

        <div className="n-p-4 n-flex n-flex-col n-grow n-overflow-y-auto">
          {messages.length === 0 ? (
            <div className="n-flex n-flex-col ">
              <div className="n-flex n-flex-col n-gap-12">
                <Typography variant="display">
                  Hi there, how can I help you today?
                </Typography>
                <div className="n-flex n-flex-col n-gap-4">
                  <Typography variant="body-medium">Suggestions</Typography>
                  <Suggestion
                    isPrimary
                    onClick={() => {
                      void handleSend("I want to import data");
                    }}
                  >
                    I want to import data
                  </Suggestion>
                  <Suggestion
                    onClick={() => {
                      void handleSend("Create an AI agent");
                    }}
                  >
                    Create an AI agent
                  </Suggestion>
                  <Suggestion
                    onClick={() => {
                      void handleSend("Invite project members");
                    }}
                  >
                    Invite project members
                  </Suggestion>
                  <Suggestion
                    onClick={() => {
                      void handleSend("Generate a report");
                    }}
                  >
                    Generate a report
                  </Suggestion>
                </div>
                <Typography variant="body-medium">
                  You can also drag and drop files here, or{" "}
                  <TextLink as="button" type="internal-underline">
                    browse
                  </TextLink>
                  . Supports CVG, MOV, PDF
                </Typography>
              </div>
            </div>
          ) : (
            <div className="n-flex n-flex-col n-gap-4 n-pb-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`n-flex ${
                    msg.role === "user" ? "n-justify-end" : "n-justify-start"
                  }`}
                >
                  {msg.role === "user" ? (
                    <div className="n-max-w-[85%]">
                      <UserBubble
                        avatarProps={{
                          name: "NM",
                          type: "letters",
                        }}
                      >
                        {msg.content}
                      </UserBubble>
                    </div>
                  ) : (
                    <div className="n-w-full n-flex n-flex-col n-gap-2">
                      {msg.thinkingTime !== undefined && (
                        <Thinking
                          isThinking={false}
                          thinkingMs={msg.thinkingTime}
                        />
                      )}
                      <div className="n-flex n-flex-col n-gap-2">
                        <Response>{msg.content}</Response>
                        {msg.isDone === true && (
                          <div className="n-flex n-flex-row n-gap-1.5">
                            <CleanIconButton size="small" description="Dislike">
                              <HandThumbDownIconOutline />
                            </CleanIconButton>
                            <CleanIconButton size="small" description="Re-run">
                              <ArrowPathIconOutline />
                            </CleanIconButton>
                            <CleanIconButton size="small" description="Copy">
                              <Square2StackIconOutline />
                            </CleanIconButton>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isThinking && <Thinking isThinking={true} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="n-px-4 n-pt-4 n-pb-1 n-mt-auto">
          <Prompt
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onSubmitPrompt={() => void handleSend()}
            onCancelPrompt={handleCancel}
            isRunningPrompt={isThinking || isStreaming}
            isSubmitDisabled={
              prompt.length === 0 && !(isThinking || isStreaming)
            }
            bottomContent={
              <CleanIconButton description="Add files" size="small">
                <PlusIconOutline />
              </CleanIconButton>
            }
          />
        </div>
      </div>
    </section>
  );
};

export default Component;
