import { describe, expect, it, vi } from "vitest";
import { SseParser, decodeEvent } from "../src/lib/sse";
import type { AssistantEvent } from "../src/types";
import { sseFrame } from "./helpers/sse-fixture";

function parseAll(raw: string) {
  const parser = new SseParser();
  return parser.push(raw);
}

describe("SseParser incremental framing", () => {
  it("parses one event that arrives in three chunks exactly once", () => {
    const raw = sseFrame("delta", { text: "星澜科技预留了 3 个专场名额" });
    const cuts = [raw.slice(0, 7), raw.slice(7, 29), raw.slice(29)];
    const parser = new SseParser();
    const collected = cuts.flatMap((chunk) => parser.push(chunk));
    expect(collected).toHaveLength(1);
    expect(decodeEvent(collected[0])).toEqual({
      event: { type: "delta", text: "星澜科技预留了 3 个专场名额" },
      unknown: null,
    });
  });

  it("keeps two events in a single chunk separate", () => {
    const raw = sseFrame("delta", { text: "a" }) + sseFrame("delta", { text: "b" });
    const events = parseAll(raw);
    expect(events).toHaveLength(2);
    expect(events.map((item) => JSON.parse(item.data).text)).toEqual(["a", "b"]);
  });

  it("ignores heartbeat comment lines", () => {
    const raw = ": ping\n\n: ping\n\n" + sseFrame("delta", { text: "hi" });
    const events = parseAll(raw);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("delta");
  });

  it("joins multi-line data payloads with a newline", () => {
    const raw = "event: delta\ndata: line one\ndata: line two\n\n";
    const events = parseAll(raw);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("line one\nline two");
  });

  it("flushes an unterminated trailing event on end()", () => {
    const parser = new SseParser();
    expect(parser.push("event: delta\ndata: {\"text\":\"tail\"}")).toHaveLength(0);
    const tail = parser.end();
    expect(tail).toHaveLength(1);
    expect(decodeEvent(tail[0]).event).toEqual({ type: "delta", text: "tail" });
  });
});

describe("decodeEvent covers all eight assistant events", () => {
  const cases: Array<[string, Record<string, unknown>, AssistantEvent]> = [
    ["message_start", { message_id: "msg_1", role: "assistant" }, { type: "message_start", messageId: "msg_1", role: "assistant" }],
    ["delta", { text: "片段" }, { type: "delta", text: "片段" }],
    [
      "tool_call",
      { tool_call_id: "tool_1", name: "search_member_spaces", arguments: { keyword: "对接会" } },
      { type: "tool_call", toolCallId: "tool_1", name: "search_member_spaces", args: { keyword: "对接会" } },
    ],
    [
      "tool_confirmation_required",
      { tool_call_id: "tool_1", name: "search_member_spaces", prompt: "是否继续？" },
      { type: "tool_confirmation_required", toolCallId: "tool_1", name: "search_member_spaces", prompt: "是否继续？" },
    ],
    [
      "tool_result",
      { tool_call_id: "tool_1", ok: true, summary: "匹配到 3 个专场" },
      { type: "tool_result", toolCallId: "tool_1", ok: true, summary: "匹配到 3 个专场" },
    ],
    [
      "citation",
      { index: 2, title: "资源对接手册（虚构）", url: "https://example.com/handbook" },
      { type: "citation", index: 2, title: "资源对接手册（虚构）", url: "https://example.com/handbook" },
    ],
    ["message_end", { message_id: "msg_1", finish_reason: "stop" }, { type: "message_end", messageId: "msg_1", finishReason: "stop" }],
    ["error", { code: "TOOL_FAILED", message: "工具调用失败" }, { type: "error", code: "TOOL_FAILED", message: "工具调用失败" }],
  ];

  it.each(cases)("maps %s onto its typed action", (event, payload, expected) => {
    const parser = new SseParser();
    const [wire] = parser.push(sseFrame(event, payload));
    expect(decodeEvent(wire).event).toEqual(expected);
  });

  it("reports unknown event names instead of throwing", () => {
    const warn = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const parser = new SseParser();
    const [wire] = parser.push(sseFrame("budget_exceeded", { hint: "later" }));
    const outcome = decodeEvent(wire);
    expect(outcome.event).toBeNull();
    expect(outcome.unknown).toBe("budget_exceeded");
    warn.mockRestore();
  });

  it("reports malformed JSON instead of throwing", () => {
    const parser = new SseParser();
    const [wire] = parser.push("event: delta\ndata: {not json\n\n");
    expect(decodeEvent(wire)).toEqual({ event: null, unknown: "delta:invalid-json" });
  });
});

