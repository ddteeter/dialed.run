import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useControlGate } from "../../src/ui";
import type { ControlGate } from "../../src/ui";

/**
 * `useControlGate`: a control that waits for something acts when it may,
 * and opens the screen's one sheet when it may not (round 26 #11).
 */
function Screen({ gate }: Readonly<{ gate: ControlGate }>) {
  const { guard, sheet } = useControlGate(gate);
  return (
    <>
      <p>{guard.canAct ? "may act" : "waits"}</p>
      <button type="button" onClick={guard.ask}>
        Press
      </button>
      {sheet}
    </>
  );
}

function stubGate(canAct: boolean) {
  const sheet = vi.fn((isOpen: boolean, onClose: () => void) =>
    isOpen ? (
      <div role="dialog" aria-label="Waiting">
        <button type="button" onClick={onClose}>
          Not now
        </button>
      </div>
    ) : undefined,
  );
  return { canAct, sheet };
}

describe("useControlGate", () => {
  it("passes on whether the control may act", () => {
    const { rerender } = render(<Screen gate={stubGate(true)} />);
    expect(screen.getByText("may act")).toBeInTheDocument();

    rerender(<Screen gate={stubGate(false)} />);
    expect(screen.getByText("waits")).toBeInTheDocument();
  });

  it("keeps the sheet shut until asked, opens it on ask, and shuts it on close", async () => {
    const user = userEvent.setup();
    const gate = stubGate(false);
    render(<Screen gate={gate} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gate.sheet).toHaveBeenLastCalledWith(false, expect.any(Function));

    await user.click(screen.getByRole("button", { name: "Press" }));
    expect(screen.getByRole("dialog", { name: "Waiting" })).toBeVisible();
    expect(gate.sheet).toHaveBeenLastCalledWith(true, expect.any(Function));

    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
