import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useReturnFocus } from "../../src/ui";

/**
 * A trigger, something else to hold focus, and the press that closes a
 * step — `fireEvent.click`, which moves no focus of its own, so whatever
 * focus does is the hook's doing.
 */
function Harness({
  isShown = true,
  version = "a",
}: Readonly<{ isShown?: boolean; version?: string }>) {
  const back = useReturnFocus();
  return (
    <>
      <button type="button">elsewhere</button>
      {isShown ? (
        <button key={version} ref={back.ref} type="button">
          trigger {version}
        </button>
      ) : undefined}
      <button type="button" onClick={back.restore}>
        close
      </button>
    </>
  );
}

function focusOn(name: string): void {
  act(() => {
    screen.getByRole("button", { name }).focus();
  });
}

describe("useReturnFocus", () => {
  it("moves nothing on first paint", () => {
    render(<Harness />);
    expect(document.body).toHaveFocus();
  });

  it("returns focus to a trigger that is on screen, there and then", () => {
    render(<Harness />);
    focusOn("elsewhere");

    fireEvent.click(screen.getByRole("button", { name: "close" }));

    expect(screen.getByRole("button", { name: "trigger a" })).toHaveFocus();
  });

  it("returns focus to a trigger that is not on screen yet, the moment it mounts", () => {
    const { rerender } = render(<Harness />);
    // Gone without ever holding focus, so nothing is owed it on its own.
    rerender(<Harness isShown={false} />);

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    expect(document.body).toHaveFocus();
    rerender(<Harness />);

    expect(screen.getByRole("button", { name: "trigger a" })).toHaveFocus();
  });

  it("hands focus to the trigger's replacement when it is remounted holding it", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));

    rerender(<Harness version="b" />);

    expect(screen.getByRole("button", { name: "trigger b" })).toHaveFocus();
  });

  it("takes nothing back once focus has moved on", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "close" }));
    focusOn("elsewhere");

    rerender(<Harness version="b" />);

    expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus();
  });

  it("gives a remount nothing it did not hold", () => {
    const { rerender } = render(<Harness />);
    focusOn("elsewhere");

    rerender(<Harness version="b" />);

    expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus();
  });
});
