import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_REQUIRED_CODE } from "../../src/lib/auth-signal";
import {
  type ControlAction,
  ControlFailureBand,
  FormStatus,
  inFlight,
  PendingLabel,
  useControlAction,
} from "../../src/ui";

/**
 * Round 23, item 9 (design's product.md §4a): a control that fails outside
 * a form waits for the server, says what is still true, and keeps its
 * retry until the next attempt.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Rejects with `reason` exactly as given, never wrapped in an Error: a
 * server function's rejection has crossed a structured clone and arrives
 * as a plain object. Same helper as `verdict-form.dom.test.tsx`.
 */
function rejectWith(reason: unknown): never {
  throw reason;
}

/**
A server function's rejection for a session that has ended.
*/
async function signedOut(): Promise<never> {
  await Promise.resolve();
  return rejectWith({ code: AUTH_REQUIRED_CODE });
}

function Probe({
  action,
  onSuccess,
  onControl,
}: Readonly<{
  action: (target: string) => Promise<unknown>;
  onSuccess?: (target: string) => void;
  /**
  Hands the hook's result out, for calls a button cannot make.
  */
  onControl?: (control: ControlAction<[string]>) => void;
}>) {
  const control = useControlAction({
    action,
    kicker: "Not marked",
    onSuccess,
  });
  onControl?.(control);
  return (
    <div>
      <button
        type="button"
        {...inFlight(control.pending)}
        onClick={() => {
          void control.run("entry-1");
        }}
      >
        <PendingLabel
          label="Useful"
          pendingLabel="Noting"
          pending={control.pending}
        />
      </button>
      <button type="button" onClick={control.retry}>
        Retry from outside
      </button>
      <ControlFailureBand
        failure={control.failure}
        onRetry={control.retry}
        retryRef={control.retryRef}
      />
      <FormStatus>{control.status}</FormStatus>
    </div>
  );
}

function band(): HTMLElement | null {
  return document.querySelector("[data-part='failure-band']");
}

describe("useControlAction", () => {
  it("waits behind the in-flight label, and ignores a second press", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<undefined>();
    const action = vi.fn(() => pending.promise);
    render(<Probe action={action} />);
    const useful = screen.getByRole("button", { name: /Useful|Noting/ });

    await user.click(useful);
    await user.click(useful);

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith("entry-1");
    expect(useful).toHaveAttribute("aria-busy", "true");
    expect(useful).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      pending.resolve(undefined);
      await pending.promise;
    });
    expect(useful).not.toHaveAttribute("aria-busy");
  });

  it("calls back on success with the same arguments, and shows no band", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<Probe action={() => Promise.resolve()} onSuccess={onSuccess} />);

    await user.click(screen.getByRole("button", { name: "Useful" }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("entry-1");
    });
    expect(band()).toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("names what is still true, and why, when the connection drops", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(
      <Probe
        action={() => Promise.reject(new TypeError("Failed to fetch"))}
        onSuccess={onSuccess}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Useful" }));

    await waitFor(() => {
      expect(band()).toHaveTextContent(
        "Not markedYour connection dropped.Try again",
      );
    });
    expect(band()).toHaveAttribute("data-state", "failed");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Not marked. Your connection dropped.",
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("stops a server failure at the cause, since the kicker says what did not change", async () => {
    // A form's server line is "Our end failed. Nothing changed."; here the
    // kicker already carries the second half (§4a).
    const user = userEvent.setup();
    render(
      <Probe action={() => Promise.reject(new Error("D1 unavailable"))} />,
    );

    await user.click(screen.getByRole("button", { name: "Useful" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        /^Not marked\. Our end failed\.$/,
      );
    });
  });

  it("says a signed-out session in the contract's words", async () => {
    const user = userEvent.setup();
    render(<Probe action={signedOut} />);

    await user.click(screen.getByRole("button", { name: "Useful" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Not marked. You were signed out.",
      );
    });
  });

  it("keeps the band until the next attempt, and clears it the moment one starts", async () => {
    const user = userEvent.setup();
    const second = Promise.withResolvers<undefined>();
    const action = vi
      .fn<(target: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(second.promise);
    render(<Probe action={action} />);

    await user.click(screen.getByRole("button", { name: "Useful" }));
    await waitFor(() => {
      expect(band()).not.toBeNull();
    });

    // Try again reruns the attempt that failed, with its arguments.
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(action).toHaveBeenNthCalledWith(2, "entry-1");
    expect(band()).toBeNull();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await act(async () => {
      second.resolve(undefined);
      await second.promise;
    });
    expect(band()).toBeNull();
  });

  it("does nothing on a retry before anything has been tried, and says nothing", () => {
    // Called directly, not through a click: a retry that spread an
    // undefined argument list would throw, and a throw inside a React
    // event handler is swallowed into a console error.
    const action = vi.fn(() => Promise.resolve());
    let control: ControlAction<[string]> | undefined;
    render(
      <Probe
        action={action}
        onControl={(current) => {
          control = current;
        }}
      />,
    );

    expect(() => {
      control?.retry();
    }).not.toThrow();
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
