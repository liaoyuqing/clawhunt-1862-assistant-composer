export type AssistantEventType =
  | "message_start"
  | "delta"
  | "tool_call"
  | "tool_confirmation_required"
  | "tool_result"
  | "citation"
  | "message_end"
  | "error";

export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

export interface ToolCallState {
  id: string;
  name: string;
  status: "pending" | "awaiting_confirmation" | "done";
  summary?: string;
  prompt?: string;
}

export interface CitationState {
  index: number;
  title: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolCallState[];
  citations: CitationState[];
  status: "streaming" | "done" | "stopped" | "error";
  errorCode?: string;
  errorMessage?: string;
}

export type AssistantEvent =
  | { type: "message_start"; messageId: string; role: string }
  | { type: "delta"; text: string }
  | { type: "tool_call"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { type: "tool_confirmation_required"; toolCallId: string; name: string; prompt: string }
  | { type: "tool_result"; toolCallId: string; ok: boolean; summary: string }
  | { type: "citation"; index: number; title: string; url: string }
  | { type: "message_end"; messageId: string; finishReason: string }
  | { type: "error"; code: string; message: string };

