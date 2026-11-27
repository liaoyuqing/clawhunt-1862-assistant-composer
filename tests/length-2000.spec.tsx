import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Composer, { MAX_INPUT_LENGTH } from "../src/components/assistant/Composer";
import { expectButtonDisabled, expectButtonEnabled } from "./helpers/dom";

function setup() {
  const onSend = vi.fn();
  render(<Composer sessionId="spaces-101" onSend={onSend} />);
  const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
  return { onSend, input };
}

const han = (count: number) => "会".repeat(count);

describe("AC boundaries around the 2000 character limit", () => {
  it("sends at 1999 characters", () => {
    const { onSend, input } = setup();
    fireEvent.change(input, { target: { value: han(1999) } });
    expectButtonEnabled(screen.getByTestId("send-button"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("sends at exactly 2000 characters", () => {
    const { onSend, input } = setup();
    fireEvent.change(input, { target: { value: han(MAX_INPUT_LENGTH) } });
    expect(screen.getByTestId("char-counter").textContent).toBe("2000/2000");
    expectButtonEnabled(screen.getByTestId("send-button"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("blocks send and warns at 2001 characters", () => {
    const { onSend, input } = setup();
    fireEvent.change(input, { target: { value: han(2001) } });
    expectButtonDisabled(screen.getByTestId("send-button"));
    expect(screen.getByTestId("length-warning").textContent).toContain("2000");
    expect(screen.getByTestId("char-counter").textContent).toBe("2001/2000");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(0);
  });

  it("counts CJK characters by code point, not by UTF-16 unit", () => {
    const { input } = setup();
    fireEvent.change(input, { target: { value: han(2000) } });
    expect(screen.getByTestId("char-counter").textContent).toBe("2000/2000");
    fireEvent.change(input, { target: { value: han(2001) } });
    expect(screen.getByTestId("char-counter").textContent).toBe("2001/2000");
  });

  it("keeps an over-long paste visible instead of silently trimming it", () => {
    const { input } = setup();
    const overlong = han(2600);
    fireEvent.change(input, { target: { value: overlong } });
    expect(Array.from(input.value)).toHaveLength(2600);
    expect(screen.getByTestId("char-counter").textContent).toBe("2600/2000");
  });
});
