import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import StreamHarness from "./harness/StreamHarness";
import { FULL_STREAM, streamResponse } from "./helpers/sse-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function run(chunks: string[]) {
  const fetchImpl = vi.fn(async () => streamResponse(chunks));
  render(<StreamHarness fetchImpl={fetchImpl as unknown as typeof fetch} />);
  await act(async () => {
    fireEvent.click(screen.getByTestId("send"));
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("hook state transitions driven by the eight SSE events", () => {
  it("assembles deltas, tools, citations and finishes on message_end", async () => {
    await run(FULL_STREAM);
    expect(screen.getByTestId("assistant-count").textContent).toBe("1");
    expect(screen.getByTestId("assistant-text").textContent).toBe("星澜科技预留了 3 个专场名额。");
    expect(screen.getByTestId("tool-count").textContent).toBe("1");
    expect(screen.getByTestId("citation-count").textContent).toBe("1");
    expect(screen.getByTestId("phase").textContent).toBe("idle");
  });

  it("keeps the partial text and schedules a reconnect when the body ends without message_end", async () => {
    // A body that closes without message_end is a cut connection, not a finished
    // answer: the partial text stays and the hook enters the reconnect backoff.
    await run(FULL_STREAM.slice(0, 4));
    expect(screen.getByTestId("assistant-text").textContent).toBe("星澜科技预留了 3 个专场名额。");
    expect(screen.getByTestId("phase").textContent).toBe("retrying");
  });

  it("logs and ignores an unknown event name without failing the turn", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    await run([
      ": ping\n\n",
      'event: message_start\ndata: {"message_id":"m1"}\n\n',
      'event: budget_exceeded\ndata: {"remaining":0}\n\n',
      'event: delta\ndata: {"text":"仍可继续"}\n\n',
      'event: message_end\ndata: {"message_id":"m1"}\n\n',
    ]);
    expect(screen.getByTestId("assistant-text").textContent).toBe("仍可继续");
    expect(screen.getByTestId("phase").textContent).toBe("idle");
    expect(debug).toHaveBeenCalled();
    debug.mockRestore();
  });

  it("assembles a delta that is split across three network chunks", async () => {
    const frame = 'event: delta\ndata: {"text":"星澜科技"}\n\n';
    await run([
      ": ping\n\n",
      'event: message_start\ndata: {"message_id":"m1"}\n\n',
      frame.slice(0, 6),
      frame.slice(6, 18),
      frame.slice(18),
      'event: message_end\ndata: {"message_id":"m1"}\n\n',
    ]);
    expect(screen.getByTestId("assistant-text").textContent).toBe("星澜科技");
  });
});

