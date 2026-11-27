import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAssistantStream } from "../src/hooks/useAssistantStream";
import { FULL_STREAM, jsonResponse, streamResponse } from "./helpers/sse-fixture";

afterEach(() => vi.useRealTimers());

async function flush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("stop generation aborts the read and cancels the server job", () => {
  it("aborts, calls the cancel endpoint once, and never reconnects", async () => {
    vi.useFakeTimers();
    let chats = 0;
    let cancels = 0;
    let cancelledUrl = "";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/cancel")) {
        cancels += 1;
        cancelledUrl = url;
        return jsonResponse(200, { ok: true });
      }
      chats += 1;
      return streamResponse(FULL_STREAM, { holdOpen: true });
    });

    const { result } = renderHook(() =>
      useAssistantStream({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sessionId: "spaces-101",
        cancelEndpoint: "/api/assistant/cancel",
      }),
    );

    act(() => result.current.send("会员空间的对接流程是什么"));
    await flush(0);
    expect(chats).toBe(1);
    expect(result.current.phase).toBe("streaming");

    act(() => result.current.stop());
    await flush(0);
    expect(result.current.phase).toBe("stopped");
    expect(cancels).toBe(1);
    expect(cancelledUrl).toContain("/cancel");
    expect(result.current.messages.find((message) => message.role === "assistant")?.status).toBe("stopped");

    await flush(20000);
    expect(chats).toBe(1);
    expect(cancels).toBe(1);
  });

  it("can be pressed while a backoff is pending without triggering a reconnect", async () => {
    vi.useFakeTimers();
    let chats = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/cancel")) return jsonResponse(200, { ok: true });
      chats += 1;
      return streamResponse(FULL_STREAM.slice(0, 3), { failAfter: 1 });
    });
    const { result } = renderHook(() =>
      useAssistantStream({ fetchImpl: fetchImpl as unknown as typeof fetch, sessionId: "spaces-101" }),
    );
    act(() => result.current.send("会员空间的对接流程是什么"));
    await flush(0);
    await flush(1000);
    expect(chats).toBe(2);
    await flush(10);
    expect(result.current.phase).toBe("retrying");
    act(() => result.current.stop());
    await flush(10000);
    expect(chats).toBe(2);
    expect(result.current.phase).toBe("stopped");
  });
});

