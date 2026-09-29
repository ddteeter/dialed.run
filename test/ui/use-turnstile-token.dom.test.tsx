import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTurnstileToken } from "../../src/ui/use-turnstile-token";

/**
 * A Turnstile answer is spent by the one request that carries it, and the
 * widget is asked for another (task 126, ACC-5).
 */
describe("useTurnstileToken", () => {
  it("hands the answer over once, then has none until the widget answers again", () => {
    const { result } = renderHook(() => useTurnstileToken());
    act(() => {
      result.current.onToken("first");
    });
    let taken: string | undefined;
    act(() => {
      taken = result.current.take();
    });
    expect(taken).toBe("first");
    act(() => {
      taken = result.current.take();
    });
    expect(taken).toBeUndefined();
    act(() => {
      result.current.onToken("second");
    });
    act(() => {
      taken = result.current.take();
    });
    expect(taken).toBe("second");
  });

  it("remounts the widget each time an answer is taken", () => {
    const { result } = renderHook(() => useTurnstileToken());
    expect(result.current.widgetKey).toBe(0);
    act(() => {
      result.current.take();
    });
    expect(result.current.widgetKey).toBe(1);
    act(() => {
      result.current.take();
    });
    expect(result.current.widgetKey).toBe(2);
  });

  it("forgets an answer the widget withdrew", () => {
    const { result } = renderHook(() => useTurnstileToken());
    act(() => {
      result.current.onToken("expiring");
      result.current.onToken(undefined);
    });
    let taken: string | undefined = "not taken";
    act(() => {
      taken = result.current.take();
    });
    expect(taken).toBeUndefined();
  });

  it("keeps the same callbacks across renders, so the widget is not torn down", () => {
    const { result, rerender } = renderHook(() => useTurnstileToken());
    const { onToken, take } = result.current;
    rerender();
    expect(result.current.onToken).toBe(onToken);
    expect(result.current.take).toBe(take);
  });
});
