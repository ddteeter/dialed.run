import { useCallback, useRef, useState } from "react";

/**
 * A form's Turnstile answer, spent once (task 126, ACC-5).
 *
 * **A token works once.** Cloudflare's siteverify refuses a token it has
 * seen (`timeout-or-duplicate`), so a form that sends one and is refused
 * for something else — a used invite code, a taken limit — must not send
 * the same token again: the runner would fix the code and be told their
 * browser failed the check. `take` hands the current answer to the one
 * request that uses it and, in the same breath, forgets it and remounts
 * the widget (`widgetKey`), which asks Cloudflare for a fresh one.
 *
 * `onToken` is the widget's own callback: an answer, or `undefined` when
 * one expired or failed.
 */
export function useTurnstileToken(): {
  onToken: (token: string | undefined) => void;
  widgetKey: number;
  take: () => string | undefined;
} {
  const token = useRef<string | undefined>(undefined);
  const [widgetKey, setWidgetKey] = useState(0);
  const onToken = useCallback((next: string | undefined) => {
    token.current = next;
  }, []);
  const take = useCallback(() => {
    const taken = token.current;
    token.current = undefined;
    setWidgetKey((key) => key + 1);
    return taken;
  }, []);
  return { onToken, widgetKey, take };
}
