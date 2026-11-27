import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../lib/api";
import { SseParser, decodeEvent } from "../lib/sse";
import type { ChatMessage, SseMessage } from "../types";

/** Backoff between the first attempt and the three automatic reconnects. */
export const DEFAULT_RETRY_DELAYS: readonly number[] = [1000, 2000, 4000];

export type StreamPhase = "idle" | "streaming" | "retrying" | "failed" | "stopped" | "disabled";

export interface StreamError {
  code: string;
  message: string;
}

export interface UseAssistantStreamOptions {
  sessionId?: string;
  /** Absolute or root-relative URL; a root-relative path is prefixed with VITE_API_BASE. */
  endpoint?: string;
  cancelEndpoint?: string;
  retryDelays?: readonly number[];
  fetchImpl?: typeof fetch;
}

export interface UseAssistantStreamResult {
  messages: ChatMessage[];
  phase: StreamPhase;
  error: StreamError | null;
  retryQuestion: string | null;
  send: (question: string) => void;
  stop: () => void;
  retry: () => void;
  newSession: () => void;
}

const now = () => Date.now();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useAssistantStream(options: UseAssistantStreamOptions = {}): UseAssistantStreamResult {
  const {
    sessionId = "session-default",
    endpoint: endpointOption = "/api/assistant/chat",
    cancelEndpoint: cancelEndpointOption = "/api/assistant/cancel",
    retryDelays = DEFAULT_RETRY_DELAYS,
    fetchImpl,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<StreamPhase>("idle");
  const [error, setError] = useState<StreamError | null>(null);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);

  const endpoint = useMemo(() => apiUrl(endpointOption), [endpointOption]);
  const cancelEndpoint = useMemo(() => apiUrl(cancelEndpointOption), [cancelEndpointOption]);

  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);
  const busyRef = useRef(false);
  const seqRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);
  const retryQuestionRef = useRef<string | null>(null);
  const attemptLogRef = useRef<number[]>([]);

  const doFetch = useCallback<typeof fetch>(
    (input, init) => (fetchImpl ?? fetch)(input, init),
    [fetchImpl],
  );

  const patchMessage = useCallback((id: string, patch: (message: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((message) => (message.id === id ? patch(message) : message)));
  }, []);

  const applyWire = useCallback(
    (wire: SseMessage, assistantId: string): { terminalError?: StreamError } => {
      const { event, unknown } = decodeEvent(wire);
      if (!event) {
        if (unknown) {
          // Forward compatible: unknown event names are logged, never thrown.
          if (typeof console !== "undefined" && console.debug) {
            console.debug(`[useAssistantStream] ignoring event: ${unknown}`);
          }
        }
        return {};
      }

      switch (event.type) {
        case "message_start":
          patchMessage(assistantId, (message) => ({ ...message, status: "streaming" }));
          return {};
        case "delta":
          patchMessage(assistantId, (message) => ({ ...message, text: message.text + event.text }));
          return {};
        case "tool_call":
          patchMessage(assistantId, (message) => ({
            ...message,
            tools: [
              ...message.tools,
              { id: event.toolCallId, name: event.name, status: "pending", summary: JSON.stringify(event.args) },
            ],
          }));
          return {};
        case "tool_confirmation_required":
          patchMessage(assistantId, (message) => ({
            ...message,
            tools: message.tools.map((tool) =>
              tool.id === event.toolCallId
                ? { ...tool, status: "awaiting_confirmation", prompt: event.prompt }
                : tool,
            ),
          }));
          return {};
        case "tool_result":
          patchMessage(assistantId, (message) => ({
            ...message,
            tools: message.tools.map((tool) =>
              tool.id === event.toolCallId
                ? { ...tool, status: "done", summary: event.summary }
                : tool,
            ),
          }));
          return {};
        case "citation":
          patchMessage(assistantId, (message) => ({
            ...message,
            citations: [...message.citations, { index: event.index, title: event.title, url: event.url }],
          }));
          return {};
        case "message_end":
          patchMessage(assistantId, (message) => ({ ...message, status: "done" }));
          return {};
        case "error": {
          const streamError = { code: event.code, message: event.message };
          patchMessage(assistantId, (message) => ({
            ...message,
            status: "error",
            errorCode: streamError.code,
            errorMessage: streamError.message,
          }));
          return { terminalError: streamError };
        }
        default:
          return {};
      }
    },
    [patchMessage],
  );

  const consume = useCallback(
    async (
      body: ReadableStream<Uint8Array>,
      signal: AbortSignal,
      assistantId: string,
    ): Promise<{ terminalError: StreamError | null; completed: boolean }> => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      let terminalError: StreamError | null = null;
      let completed = false;

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (stoppedRef.current) {
            await reader.cancel().catch(() => undefined);
            return { terminalError: null, completed: false };
          }
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const wire of parser.push(chunk)) {
            if (wire.event === "message_end") completed = true;
            const outcome = applyWire(wire, assistantId);
            if (outcome.terminalError) terminalError = outcome.terminalError;
          }
        }
        const tail = decoder.decode();
        if (tail) {
          for (const wire of parser.push(tail)) {
            if (wire.event === "message_end") completed = true;
            const outcome = applyWire(wire, assistantId);
            if (outcome.terminalError) terminalError = outcome.terminalError;
          }
        }
        for (const wire of parser.end()) {
          if (wire.event === "message_end") completed = true;
          const outcome = applyWire(wire, assistantId);
          if (outcome.terminalError) terminalError = outcome.terminalError;
        }
      } catch (cause) {
        if (stoppedRef.current || signal.aborted) return { terminalError: null, completed: false };
        throw cause;
      }
      return { terminalError, completed };
    },
    [applyWire],
  );

  const runGeneration = useCallback(
    async (question: string, assistantId: string) => {
      const delays = retryDelays.length > 0 ? retryDelays : DEFAULT_RETRY_DELAYS;
      let attempt = 0;
      let lastError: StreamError = { code: "STREAM_INTERRUPTED", message: "连接中断" };

      for (;;) {
        if (attempt > 0) {
          const delay = delays[Math.min(attempt - 1, delays.length - 1)];
          setPhase("retrying");
          attemptLogRef.current.push(now());
          await sleep(delay);
          if (stoppedRef.current) return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        patchMessage(assistantId, (message) => ({
          ...message,
          text: "",
          tools: [],
          citations: [],
          status: "streaming",
          errorCode: undefined,
          errorMessage: undefined,
        }));
        setPhase("streaming");

        try {
          const response = await doFetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify({ session_id: sessionId, question }),
            signal: controller.signal,
          });

          if (stoppedRef.current || controller.signal.aborted) return;

          if (response.status === 503) {
            const payload = (await response.json().catch(() => null)) as
              | { code?: string; message?: string }
              | null;
            const code = payload?.code ?? "HTTP_503";
            const message = payload?.message ?? "服务暂时不可用，请稍后再试";
            patchMessage(assistantId, (item) => ({
              ...item,
              status: "error",
              errorCode: code,
              errorMessage: message,
            }));
            if (code === "ASSISTANT_DISABLED") {
              // A disabled assistant is not a network fault: no reconnect is scheduled.
              setError({ code, message: "助手已暂停使用" });
              setPhase("disabled");
            } else {
              setError({ code, message });
              setPhase("failed");
            }
            return;
          }

          if (!response.ok) {
            const failure = { code: `HTTP_${response.status}`, message: "请求失败，请稍后重试" };
            patchMessage(assistantId, (item) => ({
              ...item,
              status: "error",
              errorCode: failure.code,
              errorMessage: failure.message,
            }));
            setError(failure);
            setPhase("failed");
            return;
          }

          if (!response.body) throw new Error("response has no readable body");
          const outcome = await consume(response.body, controller.signal, assistantId);
          if (stoppedRef.current || controller.signal.aborted) return;

          if (outcome.terminalError) {
            setError(outcome.terminalError);
            setPhase("failed");
            return;
          }

          if (!outcome.completed) {
            // The body ended without message_end: the connection was cut, so this
            // attempt counts as a failure and goes through the same backoff.
            throw new Error("stream closed before message_end");
          }

          patchMessage(assistantId, (message) => ({ ...message, status: "done" }));
          setError(null);
          setPhase("idle");
          return;
        } catch (cause) {
          if (stoppedRef.current || controller.signal.aborted) return;
          lastError = {
            code: "STREAM_INTERRUPTED",
            message: cause instanceof Error ? `连接中断：${cause.message}` : "连接中断",
          };
          attempt += 1;
          if (attempt > delays.length) {
            patchMessage(assistantId, (item) => ({
              ...item,
              status: "error",
              errorCode: lastError.code,
              errorMessage: lastError.message,
            }));
            setError(lastError);
            setPhase("failed");
            return;
          }
        }
      }
    },
    [consume, doFetch, endpoint, patchMessage, retryDelays, sessionId],
  );

  const send = useCallback(
    (question: string) => {
      if (busyRef.current || question.trim().length === 0) return;
      busyRef.current = true;
      stoppedRef.current = false;
      retryQuestionRef.current = question;
      setRetryQuestion(question);
      setError(null);
      setPhase("streaming");
      seqRef.current += 1;
      const assistantId = `assistant-${seqRef.current}`;
      activeIdRef.current = assistantId;
      const userMessage: ChatMessage = {
        id: `user-${seqRef.current}`,
        role: "user",
        text: question,
        tools: [],
        citations: [],
        status: "done",
      };
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        tools: [],
        citations: [],
        status: "streaming",
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      void runGeneration(question, assistantId).finally(() => {
        busyRef.current = false;
        abortRef.current = null;
      });
    },
    [runGeneration],
  );

  const stop = useCallback(() => {
    if (!busyRef.current) return;
    stoppedRef.current = true;
    const controller = abortRef.current;
    abortRef.current = null;
    const assistantId = activeIdRef.current;
    if (assistantId) {
      patchMessage(assistantId, (message) => ({ ...message, status: "stopped" }));
      void doFetch(cancelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message_id: assistantId }),
      }).catch(() => undefined);
    }
    setPhase("stopped");
    busyRef.current = false;
    if (controller) controller.abort();
  }, [cancelEndpoint, doFetch, patchMessage, sessionId]);

  const retry = useCallback(() => {
    const question = retryQuestionRef.current;
    const assistantId = activeIdRef.current;
    if (!question || !assistantId || busyRef.current) return;
    busyRef.current = true;
    stoppedRef.current = false;
    setError(null);
    setPhase("streaming");
    patchMessage(assistantId, (message) => ({
      ...message,
      text: "",
      tools: [],
      citations: [],
      status: "streaming",
      errorCode: undefined,
      errorMessage: undefined,
    }));
    void runGeneration(question, assistantId).finally(() => {
      busyRef.current = false;
      abortRef.current = null;
    });
  }, [patchMessage, runGeneration]);

  const newSession = useCallback(() => {
    stoppedRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    busyRef.current = false;
    attemptLogRef.current = [];
    retryQuestionRef.current = null;
    activeIdRef.current = null;
    setMessages([]);
    setError(null);
    setRetryQuestion(null);
    setPhase("idle");
  }, []);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { messages, phase, error, retryQuestion, send, stop, retry, newSession };
}

