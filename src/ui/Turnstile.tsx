import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile's widget (OPS-5, audit §3.6), the client half of
 * the bot check on sign-up and request access. The server half is
 * `modules/ops/turnstile.ts`; placing this on the forms is task 126's.
 *
 * **Explicit rendering, `interaction-only`.** The script is loaded with
 * `render=explicit` so it never scans the page on its own, and the widget
 * is rendered into this component's own element — which is what lets a
 * client-side navigation mount and unmount it cleanly. `interaction-only`
 * keeps it invisible unless Cloudflare actually wants the visitor to do
 * something, so most people never see a surface nobody has drawn.
 *
 * The token reaches the form two ways: `onToken`, for a form that builds
 * its own payload, and the hidden `cf-turnstile-response` input the widget
 * adds to its enclosing `<form>`, for one that reads `FormData`. An expiry
 * or an error hands back `undefined`, so a stale token is never submitted.
 */

const SCRIPT_ID = "cf-turnstile-script";
export const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  appearance: "interaction-only";
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => void;
}

/**
The slice of Turnstile's global API this component uses.
*/
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

declare global {
  // The global Cloudflare's script defines. `var` is how a global is
  // declared; it is never assigned here.
  var turnstile: TurnstileApi | undefined;
}

/**
 * How long the script gets before the visitor is told it did not come.
 * Cloudflare's own widget answers in well under a second; this is for a
 * blocked or unreachable origin, which otherwise looks like a form that
 * refuses for no reason.
 */
export const SCRIPT_TIMEOUT_MS = 10_000;

/**
 * Turnstile's API once its script has run: at once if it already has,
 * otherwise after the one script tag every widget on the page shares.
 * `failed` is called instead when the script errors or has not arrived in
 * time, and nothing else is called after it. Returns what stops the wait.
 */
function whenLoaded(
  ready: (api: TurnstileApi) => void,
  failed: () => void,
): () => void {
  const loaded = globalThis.turnstile;
  if (loaded !== undefined) {
    ready(loaded);
    return noCleanup;
  }
  const script =
    document.querySelector<HTMLScriptElement>(`#${SCRIPT_ID}`) ??
    appendScript();
  let isSettled = false;
  const settle = (outcome: () => void) => {
    if (isSettled) return;
    isSettled = true;
    outcome();
  };
  const onLoad = () => {
    const api = globalThis.turnstile;
    settle(() => {
      if (api === undefined) failed();
      else ready(api);
    });
  };
  const onError = () => {
    settle(failed);
  };
  const timer = setTimeout(onError, SCRIPT_TIMEOUT_MS);
  script.addEventListener("load", onLoad);
  script.addEventListener("error", onError);
  return () => {
    clearTimeout(timer);
    script.removeEventListener("load", onLoad);
    script.removeEventListener("error", onError);
  };
}

function appendScript(): HTMLScriptElement {
  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true;
  // Not `append`: the Workers types declare an `Element.append` of their
  // own (HTMLRewriter's), which hides the DOM one on every element.
  document.head.insertAdjacentElement("beforeend", script);
  return script;
}

function noCleanup(): void {
  /*
   * The API was already there; nothing is listening.
   */
}

export function Turnstile({
  siteKey,
  action,
  onToken,
}: Readonly<{
  /**
  Absent when the deployment has none: the widget renders nothing.
  */
  siteKey: string | undefined;
  /**
  Turnstile's per-form label, shown in its analytics.
  */
  action?: string;
  onToken: (token: string | undefined) => void;
}>) {
  if (siteKey === undefined) return;
  return (
    <TurnstileWidget siteKey={siteKey} action={action} onToken={onToken} />
  );
}

function TurnstileWidget({
  siteKey,
  action,
  onToken,
}: Readonly<{
  siteKey: string;
  action: string | undefined;
  onToken: (token: string | undefined) => void;
}>) {
  // Held in a ref so a parent passing a fresh arrow every render does not
  // tear the widget down and challenge the visitor again.
  const latest = useRef(onToken);
  useEffect(() => {
    latest.current = onToken;
  }, [onToken]);
  const [hasFailed, setHasFailed] = useState(false);

  // A callback ref with a cleanup (React 19): it runs with the element on
  // mount and its cleanup on unmount, so there is no "not mounted yet"
  // branch to write.
  const mount = useCallback(
    (element: HTMLDivElement) => {
      let rendered: { api: TurnstileApi; id: string } | undefined;
      const clear = () => {
        latest.current(undefined);
      };
      const fail = () => {
        clear();
        setHasFailed(true);
      };
      const stopWaiting = whenLoaded((api) => {
        const id = api.render(element, {
          sitekey: siteKey,
          ...(action !== undefined && { action }),
          appearance: "interaction-only",
          callback: (token) => {
            latest.current(token);
          },
          "expired-callback": clear,
          "error-callback": fail,
        });
        rendered = { api, id };
      }, fail);
      return () => {
        stopWaiting();
        rendered?.api.remove(rendered.id);
      };
    },
    [siteKey, action],
  );

  return (
    <div ref={mount} data-part="turnstile">
      {hasFailed && <TurnstileFailed />}
    </div>
  );
}

/**
 * What the visitor reads when the check could not run: without it, the
 * form's refusal would look like a bug. Undesigned (placeholder protocol:
 * existing type step, no colour, no glyph); a design delta.
 */
function TurnstileFailed() {
  return (
    <p role="alert" className="text-small">
      The check that keeps out bots didn't load. Reload the page to try again.
    </p>
  );
}
