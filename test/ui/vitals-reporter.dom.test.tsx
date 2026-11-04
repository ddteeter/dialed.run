import { render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { VitalsReporter } from "../../src/ui/VitalsReporter";

/**
 * The component is the reporter's lifecycle: started with the router once
 * the page is live, stopped when the router changes or the page goes.
 * What the reporter does is `test/lib/vitals.dom.test.tsx`'s.
 */

const reporter = vi.hoisted(() => ({
  start: vi.fn<(router: unknown) => () => void>(),
  router: { current: {} },
}));

vi.mock("../../src/lib/browser/vitals", () => ({
  startVitalsReporter: reporter.start,
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => reporter.router.current,
}));

afterEach(() => {
  reporter.start.mockReset();
});

it("starts the reporter with the router, once, and renders nothing", () => {
  const stop = vi.fn();
  reporter.start.mockReturnValue(stop);
  const first = { name: "first" };
  reporter.router.current = first;

  const { container, rerender, unmount } = render(<VitalsReporter />);
  expect(container).toBeEmptyDOMElement();
  expect(reporter.start).toHaveBeenCalledExactlyOnceWith(first);

  rerender(<VitalsReporter />);
  expect(reporter.start).toHaveBeenCalledOnce();
  expect(stop).not.toHaveBeenCalled();

  unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it("restarts the reporter when the router changes", () => {
  const stop = vi.fn();
  reporter.start.mockReturnValue(stop);
  reporter.router.current = { name: "first" };
  const { rerender } = render(<VitalsReporter />);

  const second = { name: "second" };
  reporter.router.current = second;
  rerender(<VitalsReporter />);
  expect(stop).toHaveBeenCalledOnce();
  expect(reporter.start).toHaveBeenLastCalledWith(second);
});
