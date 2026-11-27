/** Test-only helpers that fabricate SSE responses the way the mock server sends them. */

export function sseFrame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export const FULL_STREAM: string[] = [
  ": ping\n\n",
  sseFrame("message_start", { message_id: "msg_1", role: "assistant" }),
  sseFrame("delta", { text: "星澜科技" }),
  sseFrame("delta", { text: "预留了 3 个专场名额。" }),
  sseFrame("tool_call", { tool_call_id: "tool_1", name: "search_member_spaces", arguments: { keyword: "对接会" } }),
  sseFrame("tool_confirmation_required", {
    tool_call_id: "tool_1",
    name: "search_member_spaces",
    prompt: "将读取可公开的资源目录，是否继续？",
  }),
  sseFrame("tool_result", { tool_call_id: "tool_1", ok: true, summary: "匹配到 3 个专场" }),
  sseFrame("citation", { index: 1, title: "资源对接手册（虚构）", url: "https://example.com/handbook" }),
  sseFrame("message_end", { message_id: "msg_1", finish_reason: "stop" }),
];

export interface StreamOptions {
  /** Deliver this many chunks, then fail the stream like a dropped socket. */
  failAfter?: number;
  /** Never close the stream so a test can abort it mid-flight. */
  holdOpen?: boolean;
  onCancel?: () => void;
}

export function streamResponse(chunks: string[], options: StreamOptions = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < chunks.length; index += 1) {
        if (options.failAfter !== undefined && index >= options.failAfter) break;
        controller.enqueue(encoder.encode(chunks[index]));
      }
      if (options.failAfter !== undefined) {
        controller.error(new Error("socket hang up"));
      } else if (!options.holdOpen) {
        controller.close();
      }
    },
    cancel() {
      options.onCancel?.();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

export function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

