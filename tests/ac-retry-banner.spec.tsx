import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AssistantChat from "../src/components/assistant/AssistantChat";
import { FULL_STREAM, streamResponse } from "./helpers/sse-fixture";

const DROP = FULL_STREAM.slice(0, 3);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AC2 the retry banner appears only after the third reconnect fails", () => {
  it("shows 重试 after three reconnects and completes on click", async () => {
    vi.useFakeTimers();
    let chats = 0;
    const fetchImpl = vi.fn(async () => {
      chats += 1;
      if (chats <= 4) return streamResponse(DROP, { failAfter: 1 });
      return streamResponse(FULL_STREAM);
    });
    vi.stubGlobal("fetch", fetchImpl);

    render(<AssistantChat sessionId="spaces-101" />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "会员空间的对接流程是什么" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
    });

    expect(chats).toBe(1);
    expect(screen.queryByTestId("retry-banner")).toBeNull();

    await advance(1000);
    expect(chats).toBe(2);
    expect(screen.queryByTestId("retry-banner")).toBeNull();
    await advance(2000);
    expect(chats).toBe(3);
    expect(screen.queryByTestId("retry-banner")).toBeNull();
    await advance(4000);
    expect(chats).toBe(4);

    await advance(0);
    const banner = screen.getByTestId("retry-banner");
    expect(banner.textContent).toContain("STREAM_INTERRUPTED");
    expect(screen.getByTestId("retry-button")).toBeInTheDocument();
    expect(screen.queryByTestId("stop-button")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("retry-button"));
      await Promise.resolve();
    });
    expect(chats).toBe(5);
    await advance(0);

    expect(screen.queryByTestId("retry-banner")).toBeNull();
    expect(screen.getAllByTestId("assistant-msg")).toHaveLength(1);
    expect(screen.getAllByTestId("assistant-msg")[0].textContent).toContain(
      "星澜科技预留了 3 个专场名额。",
    );
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).disabled).toBe(false);
  });
});

