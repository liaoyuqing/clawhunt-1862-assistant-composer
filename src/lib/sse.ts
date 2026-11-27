import type { AssistantEvent, SseMessage } from "../types";

/**
 * Incremental SSE parser.
 *
 * The reader feeds raw string chunks exactly as they come off the wire; an event
 * that is split across several chunks is buffered until its terminating blank
 * line arrives, so one logical event is dispatched exactly once. Comment lines
 * (": ping" heartbeats) are dropped without touching the event buffer.
 */
export class SseParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private lastId: string | undefined;

  /** Feed a chunk, return every complete event it closes. */
  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const out: SseMessage[] = [];

    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        const message = this.flush();
        if (message) out.push(message);
        continue;
      }
      if (line.startsWith(":")) continue;

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "event") this.eventName = value;
      else if (field === "data") this.dataLines.push(value);
      else if (field === "id") this.lastId = value;
      // "retry" is a hint from the server; the client owns the backoff policy in useAssistantStream.
    }

    return out;
  }

  /** Flush a trailing event that ended without a final blank line. */
  end(): SseMessage[] {
    if (this.buffer.length > 0) {
      const rest = this.buffer.replace(/\r$/, "");
      this.buffer = "";
      if (rest.startsWith("data:")) this.dataLines.push(rest.slice(5).replace(/^ /, ""));
    }
    const message = this.flush();
    return message ? [message] : [];
  }

  private flush(): SseMessage | null {
    if (this.dataLines.length === 0) {
      this.eventName = "";
      return null;
    }
    const message: SseMessage = {
      event: this.eventName || "message",
      data: this.dataLines.join("\n"),
    };
    if (this.lastId !== undefined) message.id = this.lastId;
    this.eventName = "";
    this.dataLines = [];
    return message;
  }
}

export interface DecodeOutcome {
  event: AssistantEvent | null;
  unknown: string | null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/** Map one wire event onto the typed assistant event union. */
export function decodeEvent(message: SseMessage): DecodeOutcome {
  let payload: Record<string, unknown>;
  try {
    payload = message.data ? (JSON.parse(message.data) as Record<string, unknown>) : {};
  } catch {
    return { event: null, unknown: `${message.event}:invalid-json` };
  }

  switch (message.event) {
    case "message_start":
      return {
        event: {
          type: "message_start",
          messageId: str(payload.message_id ?? payload.id),
          role: str(payload.role, "assistant"),
        },
        unknown: null,
      };
    case "delta":
      return { event: { type: "delta", text: str(payload.text ?? payload.delta) }, unknown: null };
    case "tool_call":
      return {
        event: {
          type: "tool_call",
          toolCallId: str(payload.tool_call_id ?? payload.id),
          name: str(payload.name),
          args: (payload.arguments ?? payload.args ?? {}) as Record<string, unknown>,
        },
        unknown: null,
      };
    case "tool_confirmation_required":
      return {
        event: {
          type: "tool_confirmation_required",
          toolCallId: str(payload.tool_call_id ?? payload.id),
          name: str(payload.name),
          prompt: str(payload.prompt),
        },
        unknown: null,
      };
    case "tool_result":
      return {
        event: {
          type: "tool_result",
          toolCallId: str(payload.tool_call_id ?? payload.id),
          ok: payload.ok !== false,
          summary: str(payload.summary),
        },
        unknown: null,
      };
    case "citation":
      return {
        event: {
          type: "citation",
          index: typeof payload.index === "number" ? payload.index : 0,
          title: str(payload.title),
          url: str(payload.url),
        },
        unknown: null,
      };
    case "message_end":
      return {
        event: {
          type: "message_end",
          messageId: str(payload.message_id ?? payload.id),
          finishReason: str(payload.finish_reason, "stop"),
        },
        unknown: null,
      };
    case "error":
      return {
        event: {
          type: "error",
          code: str(payload.code, "UNKNOWN"),
          message: str(payload.message, "助手暂时不可用"),
        },
        unknown: null,
      };
    default:
      // Unknown event names are logged and skipped so a newer server cannot crash the client.
      return { event: null, unknown: message.event };
  }
}

