import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TURNSTILE_SCRIPT_SRC,
  Turnstile,
  type TurnstileApi,
} from "../../src/ui/Turnstile";

/**
 * The Turnstile widget (OPS-5). Cloudflare's script cannot run here —
 * happy-dom refuses to execute a fetched script — so `window.turnstile` is
 * a stand-in that records what the component asked of it, and "the script
 * loaded" is a `load` event on the tag the component added.
 */

type RenderOptions = Parameters<TurnstileApi["render"]>[1];

function fakeTurnstile() {
  const rendered: { container: HTMLElement; options: RenderOptions }[] = [];
  const removed: string[] = [];
  const api: TurnstileApi = {
    render(container, options) {
      rendered.push({ container, options });
      return `widget-${String(rendered.length)}`;
    },
    remove(widgetId) {
      removed.push(widgetId);
    },
  };
  return { api, rendered, removed };
}

function scriptTags(): HTMLScriptElement[] {
  return [...document.querySelectorAll<HTMLScriptElement>("script")].filter(
    (script) => script.src === TURNSTILE_SCRIPT_SRC,
  );
}

function ignore(): void {
  /*
   * A token nobody in this test reads.
   */
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const script of scriptTags()) script.remove();
});

describe("Turnstile", () => {
  it("renders nothing and loads nothing without a site key", () => {
    const { container } = render(
      <Turnstile siteKey={undefined} onToken={ignore} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(scriptTags()).toHaveLength(0);
  });

  it("renders the widget into its own element with the site key, invisibly unless needed", () => {
    const fake = fakeTurnstile();
    vi.stubGlobal("turnstile", fake.api);

    const { container } = render(
      <Turnstile siteKey="1x00000000000000000000AA" onToken={ignore} />,
    );

    const host = container.querySelector('[data-part="turnstile"]');
    expect(fake.rendered).toHaveLength(1);
    expect(fake.rendered[0]?.container).toBe(host);
    expect(fake.rendered[0]?.options).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      appearance: "interaction-only",
    });
    expect(fake.rendered[0]?.options).not.toHaveProperty("action");
  });

  it("labels the widget with its action when given one", () => {
    const fake = fakeTurnstile();
    vi.stubGlobal("turnstile", fake.api);

    render(<Turnstile siteKey="key" action="signup" onToken={ignore} />);

    expect(fake.rendered[0]?.options.action).toBe("signup");
  });

  it("hands the token over, and takes it back when it expires or errors", () => {
    const fake = fakeTurnstile();
    vi.stubGlobal("turnstile", fake.api);
    const onToken = vi.fn();
    render(<Turnstile siteKey="key" onToken={onToken} />);
    const options = fake.rendered[0]?.options;

    options?.callback("tok-1");
    options?.["expired-callback"]();
    options?.callback("tok-2");
    options?.["error-callback"]();

    expect(onToken.mock.calls).toStrictEqual([
      ["tok-1"],
      [undefined],
      ["tok-2"],
      [undefined],
    ]);
  });

  it("gives the token to the latest onToken without rendering the widget again", () => {
    const fake = fakeTurnstile();
    vi.stubGlobal("turnstile", fake.api);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Turnstile siteKey="key" onToken={first} />);

    rerender(<Turnstile siteKey="key" onToken={second} />);
    fake.rendered[0]?.options.callback("tok");

    expect(fake.rendered).toHaveLength(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("tok");
  });

  it("removes the widget it rendered when it unmounts", () => {
    const fake = fakeTurnstile();
    vi.stubGlobal("turnstile", fake.api);
    const { unmount } = render(<Turnstile siteKey="key" onToken={ignore} />);

    unmount();

    expect(fake.removed).toStrictEqual(["widget-1"]);
  });

  it("loads Cloudflare's script once, explicitly, and renders when it arrives", () => {
    const fake = fakeTurnstile();
    render(
      <>
        <Turnstile siteKey="key" onToken={ignore} />
        <Turnstile siteKey="key" onToken={ignore} />
      </>,
    );

    const [script, ...others] = scriptTags();
    expect(others).toHaveLength(0);
    expect(script?.async).toBe(true);
    expect(script?.parentElement).toBe(document.head);
    expect(fake.rendered).toHaveLength(0);

    vi.stubGlobal("turnstile", fake.api);
    act(() => {
      script?.dispatchEvent(new Event("load"));
    });

    expect(fake.rendered).toHaveLength(2);
  });

  it("renders nothing if the script loads without defining Turnstile", () => {
    const fake = fakeTurnstile();
    render(<Turnstile siteKey="key" onToken={ignore} />);

    act(() => {
      scriptTags()[0]?.dispatchEvent(new Event("load"));
    });

    expect(fake.rendered).toHaveLength(0);
  });

  it("stops waiting for the script when it unmounts first", () => {
    const fake = fakeTurnstile();
    const { unmount } = render(<Turnstile siteKey="key" onToken={ignore} />);
    const [script] = scriptTags();

    unmount();
    vi.stubGlobal("turnstile", fake.api);
    script?.dispatchEvent(new Event("load"));

    expect(fake.rendered).toHaveLength(0);
    expect(fake.removed).toHaveLength(0);
  });
});
