import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AssistantChat from "../src/components/assistant/AssistantChat";
import { expectButtonDisabled, expectButtonEnabled } from "./helpers/dom";
import { jsonResponse } from "./helpers/sse-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubChat(payload: { code: string; message: string }) {
  const chat = vi.fn(async () => jsonResponse(503, payload));
  vi.stubGlobal("fetch", chat);
  return chat;
}

async function submit(text: string) {
  const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
    await Promise.resolve();
  });
}

describe("AC3 503 ASSISTANT_DISABLED disables the composer", () => {
  it("disables input and send, shows the paused copy and does not reconnect", async () => {
    const chat = stubChat({ code: "ASSISTANT_DISABLED", message: "助手已暂停使用" });
    render(<AssistantChat sessionId="spaces-101" />);
    await submit("会员空间的对接流程是什么");

    await waitFor(() => expect(screen.getByTestId("paused-notice")).toBeInTheDocument());
    expect(screen.getByTestId("paused-notice").textContent).toBe("助手已暂停使用");
    expect(screen.getByTestId("composer-input")).toBeDisabled();
    expectButtonDisabled(screen.getByTestId("send-button"));

    // A disabled assistant is a policy state, not a network fault: exactly one request.
    expect(chat).toHaveBeenCalledTimes(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(chat).toHaveBeenCalledTimes(1);

    // The turn still appears in the transcript so the user sees what failed.
    expect(screen.getAllByTestId("user-msg")).toHaveLength(1);
    expect(screen.getAllByTestId("assistant-msg")).toHaveLength(1);
    expect(screen.queryByTestId("retry-button")).toBeNull();
  });

  it("keeps the composer usable for a non-disabled 503 code", async () => {
    const chat = stubChat({ code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试" });
    render(<AssistantChat sessionId="spaces-101" />);
    await submit("会员空间的对接流程是什么");

    await waitFor(() => expect(screen.getByTestId("retry-banner")).toBeInTheDocument());
    expect(screen.getByTestId("retry-banner").textContent).toContain("RATE_LIMITED");
    expect(screen.queryByTestId("paused-notice")).toBeNull();
    expect(screen.getByTestId("composer-input")).not.toBeDisabled();

    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "再问一次" } });
    expectButtonEnabled(screen.getByTestId("send-button"));
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

