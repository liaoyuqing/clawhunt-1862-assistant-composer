import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAssistantStream } from "../src/hooks/useAssistantStream";
import { FULL_STREAM, jsonResponse, streamResponse } from "./helpers/sse-fixture";

const DROP_CHUNKS = FULL_STREAM.slice(0, 3); // heartbeat + message_start + first delta

async function flush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AC2 automatic reconnection: three retries, one request budget", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reconnects at 1000/2000/4000 ms, fails after four requests, retry reuses the question", async () => {
    const timestamps: number[] = [];
    let chats = 0;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      timestamps.push(Date.now());
      chats += 1;
      if (chats <= 4) return streamResponse(DROP_CHUNKS, { failAfter: 1 });
      return streamResponse(FULL_STREAM);
    });

    const { result } = renderHook(() =>
      useAssistantStream({ fetchImpl: fetchImpl as unknown as typeof fetch, sessionId: "spaces-101" }),
    );

    act(() => result.current.send("会员空间的对接流程是什么"));
    await flush(0);
    expect(chats).toBe(1);
    // The fixture closes after its first chunk, so the first attempt has already
    // failed and the hook is waiting for the 1000 ms reconnect.
    expect(result.current.phase).toBe("retrying");

    await flush(999);
    expect(chats).toBe(1);
    await flush(1);
    expect(chats).toBe(2);
    expect(result.current.phase).toBe("retrying");

    await flush(1999);
    expect(chats).toBe(2);
    await flush(1);
    expect(chats).toBe(3);

    await flush(3999);
    expect(chats).toBe(3);
    await flush(1);
    expect(chats).toBe(4);

    await flush(0);
    expect(chats).toBe(4);
    expect(result.current.phase).toBe("failed");
    expect(result.current.error?.code).toBe("STREAM_INTERRUPTED");
    expect(result.current.retryQuestion).toBe("会员空间的对接流程是什么");

    expect(timestamps).toHaveLength(4);
    expect(timestamps[1] - timestamps[0]).toBe(1000);
    expect(timestamps[2] - timestamps[1]).toBe(2000);
    expect(timestamps[3] - timestamps[2]).toBe(4000);

    act(() => result.current.retry());
    await flush(0);
    expect(chats).toBe(5);
    const lastBody = JSON.parse(String(fetchImpl.mock.calls[4][1]?.body ?? "{}"));
    expect(lastBody.question).toBe("会员空间的对接流程是什么");

    await flush(0);
    expect(result.current.phase).toBe("idle");
    expect(result.current.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(result.current.messages.find((message) => message.role === "assistant")?.text).toBe("星澜科技预留了 3 个专场名额。");
  });

  it("stops a pending backoff, so no reconnect is scheduled", async () => {
    let chats = 0;
    let cancels = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/cancel")) {
        cancels += 1;
        return jsonResponse(200, { ok: true });
      }
      chats += 1;
      return streamResponse(DROP_CHUNKS, { failAfter: 1 });
    });

    const { result } = renderHook(() =>
      useAssistantStream({ fetchImpl: fetchImpl as unknown as typeof fetch, sessionId: "spaces-101" }),
    );

    act(() => result.current.send("会员空间的对接流程是什么"));
    await flush(0);
    expect(chats).toBe(1);
    expect(result.current.phase).toBe("retrying");

    act(() => result.current.stop());
    await flush(0);
    expect(cancels).toBe(1);
    expect(result.current.phase).toBe("stopped");
    await flush(10000);
    expect(chats).toBe(1);
    expect(cancels).toBe(1);
  });

  it("treats an error event as terminal and does not reconnect", async () => {
    let chats = 0;
    const fetchImpl = vi.fn(async () => {
      chats += 1;
      return streamResponse([
        ": ping\n\n",
        'event: message_start\ndata: {"message_id":"m1"}\n\n',
        'event: error\ndata: {"code":"UPSTREAM_TIMEOUT","message":"上游模型超时"}\n\n',
      ]);
    });
    const { result } = renderHook(() =>
      useAssistantStream({ fetchImpl: fetchImpl as unknown as typeof fetch, sessionId: "spaces-101" }),
    );
    act(() => result.current.send("会员空间的对接流程是什么"));
    await flush(0);
    expect(chats).toBe(1);
    expect(result.current.phase).toBe("failed");
    expect(result.current.error).toEqual({ code: "UPSTREAM_TIMEOUT", message: "上游模型超时" });
    await flush(10000);
    expect(chats).toBe(1);
  });
});

