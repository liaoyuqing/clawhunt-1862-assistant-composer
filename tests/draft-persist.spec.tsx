import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/App";
import AssistantChat from "../src/components/assistant/AssistantChat";
import Composer, { draftKey } from "../src/components/assistant/Composer";
import { FULL_STREAM, streamResponse } from "./helpers/sse-fixture";

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function stubStream() {
  vi.stubGlobal("fetch", vi.fn(async () => streamResponse(FULL_STREAM)));
}

describe("AC4 unsent draft survives closing and reopening the panel", () => {
  it("restores the draft after unmount and remount", () => {
    const onSend = vi.fn();
    const { unmount } = render(<Composer sessionId="spaces-101" onSend={onSend} />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "会员空间的对接流程是什么" } });
    expect(window.sessionStorage.getItem(draftKey("spaces-101"))).toBe("会员空间的对接流程是什么");

    unmount();
    render(<Composer sessionId="spaces-101" onSend={onSend} />);
    const reopened = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(reopened.value).toBe("会员空间的对接流程是什么");
    expect(onSend).toHaveBeenCalledTimes(0);
  });

  it("keeps one draft per session so two sessions never overwrite each other", () => {
    const onSend = vi.fn();
    const { rerender } = render(<Composer sessionId="spaces-101" onSend={onSend} />);
    let input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "会话一的草稿" } });

    rerender(<Composer sessionId="spaces-202" onSend={onSend} />);
    input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "会话二的草稿" } });

    expect(window.sessionStorage.getItem(draftKey("spaces-101"))).toBe("会话一的草稿");
    expect(window.sessionStorage.getItem(draftKey("spaces-202"))).toBe("会话二的草稿");
    expect(draftKey("spaces-101")).not.toBe(draftKey("spaces-202"));

    rerender(<Composer sessionId="spaces-101" onSend={onSend} />);
    input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(input.value).toBe("会话一的草稿");
  });

  it("clears the stored draft once the message is sent", async () => {
    stubStream();
    render(<AssistantChat sessionId="spaces-101" />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "会员空间的对接流程是什么" } });
    expect(window.sessionStorage.getItem(draftKey("spaces-101"))).toBe("会员空间的对接流程是什么");

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
    });

    expect(window.sessionStorage.getItem(draftKey("spaces-101"))).toBeNull();
    expect(input.value).toBe("");
    await waitFor(() => expect(screen.getAllByTestId("assistant-msg")).toHaveLength(1));
  });

  it("keeps the draft when the panel is closed and reopened from the header", () => {
    render(<App />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "关闭面板前写了一半的问题" } });

    fireEvent.click(screen.getByTestId("toggle-panel"));
    expect(screen.queryByTestId("composer-input")).toBeNull();
    expect(window.sessionStorage.getItem(draftKey("spaces-101"))).toBe("关闭面板前写了一半的问题");

    fireEvent.click(screen.getByTestId("toggle-panel"));
    const reopened = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    expect(reopened.value).toBe("关闭面板前写了一半的问题");
  });

  it("drops the draft when the new-session button is pressed", async () => {
    stubStream();
    render(<AssistantChat sessionId="spaces-101" />);
    const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "将被丢弃的草稿" } });

    await act(async () => {
      fireEvent.click(screen.getByTestId("new-session"));
      await Promise.resolve();
    });

    expect(window.sessionStorage.getItem(draftKey("spaces-101"))).toBeNull();
    expect((screen.getByTestId("composer-input") as HTMLTextAreaElement).value).toBe("");
  });
});

