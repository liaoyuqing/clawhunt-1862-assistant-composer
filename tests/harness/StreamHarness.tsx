import { useAssistantStream } from "../../src/hooks/useAssistantStream";

export interface StreamHarnessProps {
  fetchImpl: typeof fetch;
  sessionId?: string;
  retryDelays?: readonly number[];
}

/** Minimal consumer of the hook: one send button, one retry button and a dump of state. */
export default function StreamHarness({ fetchImpl, sessionId = "spaces-101", retryDelays }: StreamHarnessProps) {
  const stream = useAssistantStream({ fetchImpl, sessionId, retryDelays });
  return (
    <div>
      <button data-testid="send" onClick={() => stream.send("会员空间的对接流程是什么")}>
        send
      </button>
      <button data-testid="retry" onClick={stream.retry}>
        retry
      </button>
      <button data-testid="stop" onClick={stream.stop}>
        stop
      </button>
      <span data-testid="phase">{stream.phase}</span>
      <span data-testid="error-code">{stream.error?.code ?? ""}</span>
      <span data-testid="error-message">{stream.error?.message ?? ""}</span>
      <span data-testid="message-count">{stream.messages.length}</span>
      <span data-testid="assistant-count">
        {stream.messages.filter((message) => message.role === "assistant").length}
      </span>
      <span data-testid="assistant-text">
        {stream.messages.filter((message) => message.role === "assistant").map((message) => message.text).join("|")}
      </span>
      <span data-testid="tool-count">
        {stream.messages.flatMap((message) => message.tools).length}
      </span>
      <span data-testid="citation-count">
        {stream.messages.flatMap((message) => message.citations).length}
      </span>
    </div>
  );
}

