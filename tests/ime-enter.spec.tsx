import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Composer from "../src/components/assistant/Composer";

function setup() {
  const onSend = vi.fn();
  render(<Composer sessionId="spaces-101" onSend={onSend} />);
  const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
  return { onSend, input };
}

function type(input: HTMLTextAreaElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("AC1 composition events suppress Enter", () => {
  it("does not send while a composition session is open", () => {
    const { onSend, input } = setup();
    type(input, "会员空间的对接流程是什么");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(0);
    expect(input.value).toBe("会员空间的对接流程是什么");
  });

  it("sends on Enter after compositionend", () => {
    const { onSend, input } = setup();
    type(input, "会员空间的对接流程是什么");
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("会员空间的对接流程是什么");
  });

  it("honours the native isComposing flag even without composition events", () => {
    const { onSend, input } = setup();
    type(input, "恒泰智造");
    // Some browsers deliver keydown mid-composition with isComposing=true and no
    // compositionend yet. jsdom honours KeyboardEventInit.isComposing, so this is the
    // genuine native-flag path, independent from the composition event handlers.
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onSend).toHaveBeenCalledTimes(0);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("keeps Shift+Enter as a newline in both states", () => {
    const { onSend, input } = setup();
    type(input, "第一行");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.compositionEnd(input);
    expect(onSend).toHaveBeenCalledTimes(0);
  });
});
