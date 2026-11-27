import { useEffect, useMemo, useState } from "react";
import { Button } from "tdesign-react";
import Composer, { sessionStorageDraftStore } from "./Composer";
import RetryBanner from "./RetryBanner";
import StopButton from "./StopButton";
import { useAssistantStream } from "../../hooks/useAssistantStream";

export interface AssistantChatProps {
  sessionId: string;
  onNewSession?: () => void;
  panelOpen?: boolean;
}

export default function AssistantChat({ sessionId, onNewSession, panelOpen = true }: AssistantChatProps) {
  const stream = useAssistantStream({ sessionId });
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [composerEpoch, setComposerEpoch] = useState(0);

  const generating = stream.phase === "streaming" || stream.phase === "retrying";
  const disabled = stream.phase === "disabled";

  useEffect(() => {
    if (stream.phase === "retrying") setRetryAttempt((value) => value + 1);
    if (stream.phase === "streaming" || stream.phase === "idle") setRetryAttempt(0);
  }, [stream.phase]);

  const handleNewSession = () => {
    sessionStorageDraftStore.clear(sessionId);
    stream.newSession();
    // Remounting the composer drops its local value along with the stored draft.
    setComposerEpoch((epoch) => epoch + 1);
    onNewSession?.();
  };

  const messages = useMemo(() => stream.messages, [stream.messages]);

  if (!panelOpen) return null;

  return (
    <section className="assistant-chat" data-testid="assistant-chat" aria-label="AI 助手">
      <header className="assistant-chat__header">
        <h2>AI 助手</h2>
        <Button size="small" variant="text" data-testid="new-session" onClick={handleNewSession}>
          新会话
        </Button>
      </header>

      <div className="assistant-chat__body" data-testid="message-list">
        {messages.length === 0 ? (
          <p className="assistant-chat__empty">向助手提问，获取会员空间平台的资源与流程信息。</p>
        ) : null}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`assistant-msg assistant-msg--${message.role}`}
            data-testid={message.role === "assistant" ? "assistant-msg" : "user-msg"}
            data-status={message.status}
          >
            <div className="assistant-msg__role">{message.role === "assistant" ? "助手" : "我"}</div>
            <div className="assistant-msg__text">{message.text}</div>
            {message.tools.length > 0 ? (
              <ul className="assistant-msg__tools">
                {message.tools.map((tool) => (
                  <li key={tool.id} data-testid="tool-chip" data-status={tool.status}>
                    <span className="assistant-msg__tool-name">{tool.name}</span>
                    {tool.prompt ? <em>{tool.prompt}</em> : null}
                    {tool.status === "done" && tool.summary ? <span>{tool.summary}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {message.citations.length > 0 ? (
              <ol className="assistant-msg__citations">
                {message.citations.map((citation) => (
                  <li key={`${citation.index}-${citation.url}`} data-testid="citation">
                    [{citation.index}] {citation.title}
                  </li>
                ))}
              </ol>
            ) : null}
            {message.status === "stopped" ? (
              <p className="assistant-msg__stopped" data-testid="stopped-tag">
                已停止生成
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <StopButton visible={generating} onStop={stream.stop} />
      <RetryBanner
        error={stream.error}
        attempt={retryAttempt || 3}
        retrying={stream.phase === "retrying"}
        retryable={!disabled}
        onRetry={stream.retry}
      />
      <Composer
        key={composerEpoch}
        sessionId={sessionId}
        disabled={disabled}
        disabledHint="助手已暂停使用"
        onSend={stream.send}
      />
    </section>
  );
}

