import { expect } from "vitest";

/** TDesign renders its Button as a div with a `disabled` attribute, so jest-dom's
 *  toBeDisabled (form controls only) cannot be used. Assert the attribute and the
 *  matching disabled class instead. */
export function expectButtonDisabled(element: HTMLElement) {
  expect(element.getAttribute("aria-disabled")).toBe("true");
  expect(element.hasAttribute("disabled")).toBe(true);
  expect(element.className).toContain("t-is-disabled");
}

export function expectButtonEnabled(element: HTMLElement) {
  expect(element.getAttribute("aria-disabled")).toBe("false");
  expect(element.hasAttribute("disabled")).toBe(false);
}

