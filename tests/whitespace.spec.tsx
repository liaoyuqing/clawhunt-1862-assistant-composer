import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Composer, { isBlank } from "../src/components/assistant/Composer";
import { expectButtonDisabled } from "./helpers/dom";

function setup() {
  const onSend = vi.fn();
  render(<Composer sessionId="spaces-101" onSend={onSend} />);
  const input = screen.getByTestId("composer-input") as HTMLTextAreaElement;
  return { onSend, input };
}

describe("blank input never sends", () => {
  it.each([["   "], ["\u3000\u3000"], ["\n\n"], [" \u3000\n "]])("rejects %j", (value) => {
    const { onSend, input } = setup();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(0);
    expectButtonDisabled(screen.getByTestId("send-button"));
  });

  it("treats full-width spaces as blank in the helper", () => {
    expect(isBlank("\u3000")).toBe(true);
    expect(isBlank(" \u3000\n")).toBe(true);
    expect(isBlank("会")).toBe(false);
  });
});
