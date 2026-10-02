import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useControlGate } from "../../src/ui";
import type { ControlGate } from "../../src/ui";

/**
 * `useControlGate`: one sheet for the screen, opened by whichever control
 * the server refused, and saying which (round 26 #11; round 27 #17).
 */
type Trigger = "first" | "second";

function Screen({ gate }: Readonly<{ gate: ControlGate<Trigger> }>) {
  const { guard, sheet } = useControlGate(gate);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          guard.ask("first");
        }}
      >
        First
      </button>
      <button
        type="button"
        onClick={() => {
          guard.ask("second");
        }}
      >
        Second
      </button>
      {sheet}
    </>
  );
}

function stubGate() {
  return {
    sheet: vi.fn<ControlGate<Trigger>["sheet"]>(({ open, trigger }, onClose) =>
      open ? (
        <div role="dialog" aria-label="Waiting">
          <p>{trigger}</p>
          <button type="button" onClick={onClose}>
            Not now
          </button>
        </div>
      ) : undefined,
    ),
  };
}

describe("useControlGate", () => {
  it("keeps the sheet shut until asked, opens it on ask, and shuts it on close", async () => {
    const user = userEvent.setup();
    const gate = stubGate();
    render(<Screen gate={gate} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gate.sheet).toHaveBeenLastCalledWith(
      { open: false, trigger: undefined },
      expect.any(Function),
    );

    await user.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByRole("dialog", { name: "Waiting" })).toHaveTextContent(
      "first",
    );
    expect(gate.sheet).toHaveBeenLastCalledWith(
      { open: true, trigger: "first" },
      expect.any(Function),
    );

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the trigger as the sheet shuts, so its sentence does not change under it", async () => {
    const user = userEvent.setup();
    const gate = stubGate();
    render(<Screen gate={gate} />);

    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("button", { name: "Not now" }));

    expect(gate.sheet).toHaveBeenLastCalledWith(
      { open: false, trigger: "second" },
      expect.any(Function),
    );
  });

  it("is one sheet, which says the control that opened it last", async () => {
    const user = userEvent.setup();
    render(<Screen gate={stubGate()} />);

    await user.click(screen.getByRole("button", { name: "Second" }));
    await user.click(screen.getByRole("button", { name: "Not now" }));
    await user.click(screen.getByRole("button", { name: "First" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("first");
  });
});
